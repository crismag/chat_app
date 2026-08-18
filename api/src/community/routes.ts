/*
 * The Community endpoints.
 *
 *   GET    /api/communities                      — mine, and invitations to me
 *   POST   /api/communities                      — create one; creator is owner
 *   GET    /api/communities/:id                  — a community, if I am in it
 *   GET    /api/communities/:id/members          — the roster, if I am in it
 *   POST   /api/communities/:id/invitations      — invite by email (owner/mod)
 *   POST   /api/communities/:id/invitations/accept — accept an invitation to me
 *   PATCH  /api/communities/:id/members/:userId  — role, removal, mute
 *   POST   /api/communities/:id/leave            — leave voluntarily
 *
 *   GET    /api/publications                     — the authorised feed
 *   GET    /api/publications/saved               — my private bookmarks
 *   POST   /api/publications                     — publish a reflection
 *   GET    /api/publications/:id                 — one, membership re-checked
 *   DELETE /api/publications/:id                 — author; refused while reported
 *   POST   /api/publications/:id/encouraged      — toggle ♥ Encouraged
 *   POST   /api/publications/:id/save            — toggle a private Save
 *   POST   /api/publications/:id/hide            — owner/moderator; reversible
 *   POST   /api/publications/:id/report          — record; removes nothing
 *
 * ── Where authorisation happens ─────────────────────────────────────────────
 *
 * Not in this file, for reads. Every read goes through `store.publication()` or
 * `store.feed()`, which carry the visibility predicate inside the SQL, and this
 * file's only job on a read is to turn `null` into 404. That is deliberate: a
 * route that filters is a route one refactor away from leaking, and the
 * specification names counts and AI answers as the two channels that leak after
 * everything visible has been secured. There is no `.filter()` in this file.
 *
 * For writes, the pattern is uniform and stated once here: **fetch through the
 * authorised read first**, and act only on what came back. Encouraging, saving
 * and reporting a publication all require being able to see it, so they all
 * begin with the same call a plain view begins with — which means a removed
 * member cannot react to, save, or even report content they have lost access
 * to, using an id they wrote down while they still had it.
 *
 * ── The 404 that says nothing ───────────────────────────────────────────────
 *
 * A publication the viewer may not see returns exactly what a publication that
 * does not exist returns. Distinguishing them would confirm to a stranger that
 * a particular community publication is there — which is the disclosure the
 * membership boundary exists to prevent, made through a status code.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  AUDIENCES,
  CAPTION_MAX,
  CHAT_FORMATS,
  COMMUNITY_LIMITS,
  COMMUNITY_ROLES,
  MEMBERSHIP_STATES,
  MODERATION_STATES,
  PUBLICATION_REPORT_REASONS,
  canModerate,
  canShareExternally,
  grantsAccess,
  isAudience,
  isCommunityRole,
  isReportReason,
  parseHashtags,
  validateChat,
  type Audience,
} from '@chat/shared';
import type { CommunityStore, PublicationView } from './store.ts';

export type CommunityUser = { id: string; email: string };

/**
 * What this module needs from the rest of the API, stated as functions.
 *
 * It never learns what a store is, which is what keeps the reflection side and
 * the community side separable — and, more usefully, makes it obvious that
 * publishing *reads* a reflection and never writes one.
 */
export type CommunityRouteOptions = {
  currentUser: (c: Context) => CommunityUser | null;
  /** `null` when the backing cannot carry membership; every route 503s. */
  store: CommunityStore | null;
  /** The author's reflection, read-only, only if they own it. */
  reflection: (
    userId: string,
    conversationId: string,
  ) => {
    format: string;
    title: string;
    scriptureReference: string | null;
    sections: Record<string, { content: string; authorOrigin: string }>;
  } | null;
  /** Resolve an email to an account, for invitations. */
  userIdByEmail: (email: string) => string | null;
  /** Ensure the person has a public identity before their name is shown. */
  ensureIdentity: (user: CommunityUser) => { handle: string; displayName: string };
};

const UNAVAILABLE =
  'Community needs persistent storage, which this server was started without.';

/**
 * The publication as it is served.
 *
 * Built here rather than returned straight from the store, because two fields
 * are decisions rather than data:
 *
 *  - **`canShareExternally`** is computed from the audience and authorship, and
 *    when it is false there is no share affordance in the payload *at all* —
 *    no link, no URL, no token. Another member's community publication must
 *    get no external share control, and a payload that carried a URL with a
 *    `false` beside it would be one careless component away from rendering it.
 *  - **`shareUrl`** exists only when sharing is permitted, for the same reason.
 *
 * And one field is deliberately absent: there is no save count. The author must
 * never see how many people privately saved their work, so the number is not
 * computed, not stored in this shape, and not serialisable from it.
 */
function serve(view: PublicationView, origin: string) {
  const shareable = canShareExternally({
    audience: view.audience,
    isAuthor: view.isAuthor,
  });

  return {
    id: view.id,
    audience: view.audience,
    community: view.community,
    author: view.author,
    isAuthor: view.isAuthor,
    format: view.format,
    title: view.title,
    scriptureReference: view.scriptureReference,
    caption: view.caption,
    sections: view.sections,
    hashtags: view.hashtags,
    encouraged: {
      count: view.encouragedCount,
      byViewer: view.encouragedByViewer,
    },
    /* The viewer's own bookmark, and nobody else's business. */
    saved: view.savedByViewer,
    canShareExternally: shareable,
    ...(shareable && view.audience === AUDIENCES.PUBLIC
      ? { shareUrl: `${origin}/community/publications/${view.id}` }
      : {}),
    canModerate: view.canModerate,
    moderationState: view.moderationState,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
  };
}

function originOf(c: Context): string {
  try {
    return new URL(c.req.url).origin;
  } catch {
    return '';
  }
}

export function createCommunityRoutes(options: CommunityRouteOptions) {
  const app = new Hono();
  const { currentUser, store, reflection, userIdByEmail, ensureIdentity } = options;

  /**
   * Every route begins here: a session, and a store that can hold membership.
   *
   * Returning the reason rather than throwing means an unavailable Community
   * says so in a sentence the interface can show, instead of appearing broken.
   */
  const guard = (c: Context) => {
    if (!store) return { user: null, store: null, response: c.json({ error: UNAVAILABLE }, 503) };
    const user = currentUser(c);
    if (!user) {
      return { user: null, store: null, response: c.json({ error: 'Unauthenticated.' }, 401) };
    }
    return { user, store, response: null };
  };

  /* ---------------------------------------------------------- communities */

  app.get('/communities', (c) => {
    const { user, store: db, response } = guard(c);
    if (!user || !db) return response;

    return c.json({
      communities: db.myCommunities(user.id).map((community) => ({
        id: community.id,
        name: community.name,
        description: community.description,
        role: community.role,
        memberCount: community.memberCount,
        closed: community.closedAt !== null,
      })),
      /*
       * Invitations addressed to this person. Not a directory: nothing here
       * lists a community they have no relationship with, because open and
       * discoverable communities are a later phase and there is no honest way
       * to show one now.
       */
      invitations: db.myInvitations(user.id).map((community) => ({
        id: community.id,
        name: community.name,
        description: community.description,
        invitedAt: community.invitedAt,
      })),
    });
  });

  app.post('/communities', async (c) => {
    const { user, store: db, response } = guard(c);
    if (!user || !db) return response;

    const body = await c.req
      .json<{ name?: string; description?: string }>()
      .catch(() => ({}) as { name?: string; description?: string });

    const name = (body.name ?? '').trim();
    if (!name) return c.json({ error: 'A community needs a name.', field: 'name' }, 400);
    if (name.length > COMMUNITY_LIMITS.name) {
      return c.json(
        { error: `A name is at most ${COMMUNITY_LIMITS.name} characters.`, field: 'name' },
        400,
      );
    }
    const description = (body.description ?? '').trim().slice(0, COMMUNITY_LIMITS.description);

    ensureIdentity(user);
    const community = db.createCommunity({
      name,
      description,
      createdByUserId: user.id,
    });
    return c.json(
      {
        id: community.id,
        name: community.name,
        description: community.description,
        role: COMMUNITY_ROLES.OWNER,
        memberCount: 1,
        closed: false,
      },
      201,
    );
  });

  /**
   * A community, if the asker is in it.
   *
   * Same 404 for "no such community" and "not a member of it", for the same
   * reason a publication uses one 404: a private community's existence is not
   * a fact a stranger is entitled to.
   */
  const activeMembership = (db: CommunityStore, communityId: string, userId: string) => {
    const membership = db.membership(communityId, userId);
    return membership && grantsAccess(membership.state) ? membership : null;
  };

  app.get('/communities/:id', (c) => {
    const { user, store: db, response } = guard(c);
    if (!user || !db) return response;

    const id = c.req.param('id');
    const membership = activeMembership(db, id, user.id);
    const community = membership ? db.community(id) : null;
    if (!community) return c.json({ error: 'No community found.' }, 404);

    return c.json({
      id: community.id,
      name: community.name,
      description: community.description,
      role: membership?.role,
      muted: membership?.mutedAt !== null,
      closed: community.closedAt !== null,
      memberCount: db.members(id).filter((m) => grantsAccess(m.state)).length,
    });
  });

  app.get('/communities/:id/members', (c) => {
    const { user, store: db, response } = guard(c);
    if (!user || !db) return response;

    const id = c.req.param('id');
    const membership = activeMembership(db, id, user.id);
    if (!membership) return c.json({ error: 'No community found.' }, 404);

    const moderator = canModerate(membership.role);
    return c.json(
      db
        .members(id)
        /*
         * Ordinary members see the people who are actually here. Invited,
         * pending, removed and departed rows are a moderation view, and are
         * returned only to someone who can act on them.
         */
        .filter((member) => moderator || grantsAccess(member.state))
        .map((member) => ({
          userId: member.userId,
          handle: member.handle,
          displayName: member.displayName ?? 'A C.H.A.T. writer',
          role: member.role,
          state: member.state,
          muted: member.mutedAt !== null,
        })),
    );
  });

  app.post('/communities/:id/invitations', async (c) => {
    const { user, store: db, response } = guard(c);
    if (!user || !db) return response;

    const id = c.req.param('id');
    const membership = activeMembership(db, id, user.id);
    if (!membership) return c.json({ error: 'No community found.' }, 404);
    if (!canModerate(membership.role)) {
      return c.json({ error: 'Only owners and moderators may invite.' }, 403);
    }

    const body = await c.req.json<{ email?: string }>().catch(() => ({}) as { email?: string });
    const email = (body.email ?? '').trim().toLowerCase();
    const invitedId = email ? userIdByEmail(email) : null;
    if (!invitedId) {
      /*
       * Deliberately not "no account with that email". Whether an address has
       * an account here is not something an invitation form should confirm to
       * whoever types one in.
       */
      return c.json(
        { error: 'That person cannot be invited yet. They need a C.H.A.T. account first.' },
        404,
      );
    }
    if (invitedId === user.id) {
      return c.json({ error: 'You are already in this community.' }, 400);
    }

    const existing = db.membership(id, invitedId);
    if (existing && grantsAccess(existing.state)) {
      return c.json({ error: 'They are already a member.' }, 409);
    }

    db.setMembership({
      communityId: id,
      userId: invitedId,
      role: COMMUNITY_ROLES.MEMBER,
      state: MEMBERSHIP_STATES.INVITED,
      invitedByUserId: user.id,
    });
    return c.json({ ok: true, state: MEMBERSHIP_STATES.INVITED }, 201);
  });

  app.post('/communities/:id/invitations/accept', (c) => {
    const { user, store: db, response } = guard(c);
    if (!user || !db) return response;

    const id = c.req.param('id');
    const membership = db.membership(id, user.id);
    if (!membership || membership.state !== MEMBERSHIP_STATES.INVITED) {
      return c.json({ error: 'No invitation found.' }, 404);
    }
    ensureIdentity(user);
    db.setMembership({
      communityId: id,
      userId: user.id,
      role: membership.role,
      state: MEMBERSHIP_STATES.ACTIVE,
    });
    return c.json({ ok: true, state: MEMBERSHIP_STATES.ACTIVE });
  });

  /**
   * Change a membership — role, removal, or mute.
   *
   * Removal writes `removed` rather than deleting the row: the person's history
   * with the community is a fact, and re-inviting them should not look like
   * they were never here. Access ends the instant this write lands, because
   * every read re-evaluates the state rather than trusting anything issued
   * earlier.
   */
  app.patch('/communities/:id/members/:userId', async (c) => {
    const { user, store: db, response } = guard(c);
    if (!user || !db) return response;

    const id = c.req.param('id');
    const subjectId = c.req.param('userId');
    const membership = activeMembership(db, id, user.id);
    if (!membership) return c.json({ error: 'No community found.' }, 404);
    if (!canModerate(membership.role)) {
      return c.json({ error: 'Only owners and moderators may change memberships.' }, 403);
    }

    const subject = db.membership(id, subjectId);
    if (!subject) return c.json({ error: 'No such member.' }, 404);

    const body = await c.req
      .json<{ role?: string; state?: string; muted?: boolean }>()
      .catch(() => ({}) as { role?: string; state?: string; muted?: boolean });

    let role = subject.role;
    if (body.role !== undefined) {
      if (!isCommunityRole(body.role)) return c.json({ error: 'Unknown role.' }, 400);
      if (
        subject.role === COMMUNITY_ROLES.OWNER &&
        body.role !== COMMUNITY_ROLES.OWNER &&
        db.ownerCount(id) <= 1
      ) {
        return c.json(
          { error: 'Every community keeps at least one owner. Make someone else an owner first.' },
          409,
        );
      }
      /* Only an owner may create another owner. */
      if (body.role === COMMUNITY_ROLES.OWNER && membership.role !== COMMUNITY_ROLES.OWNER) {
        return c.json({ error: 'Only an owner may make someone else an owner.' }, 403);
      }
      role = body.role;
    }

    let state = subject.state;
    if (body.state !== undefined) {
      if (body.state !== MEMBERSHIP_STATES.REMOVED && body.state !== MEMBERSHIP_STATES.ACTIVE) {
        return c.json({ error: 'A membership may be set active or removed.' }, 400);
      }
      if (
        body.state === MEMBERSHIP_STATES.REMOVED &&
        subject.role === COMMUNITY_ROLES.OWNER &&
        db.ownerCount(id) <= 1
      ) {
        return c.json({ error: 'A community cannot be left without an owner.' }, 409);
      }
      state = body.state;
    }

    db.setMembership({
      communityId: id,
      userId: subjectId,
      role,
      state,
      ...(body.muted === undefined
        ? {}
        : { mutedAt: body.muted ? new Date().toISOString() : null }),
    });
    return c.json({ ok: true, role, state, muted: body.muted ?? subject.mutedAt !== null });
  });

  app.post('/communities/:id/leave', (c) => {
    const { user, store: db, response } = guard(c);
    if (!user || !db) return response;

    const id = c.req.param('id');
    const membership = activeMembership(db, id, user.id);
    if (!membership) return c.json({ error: 'No community found.' }, 404);
    if (membership.role === COMMUNITY_ROLES.OWNER && db.ownerCount(id) <= 1) {
      return c.json(
        { error: 'Make someone else an owner before leaving a community you own.' },
        409,
      );
    }
    db.setMembership({
      communityId: id,
      userId: user.id,
      role: membership.role,
      state: MEMBERSHIP_STATES.LEFT,
    });
    return c.json({ ok: true, state: MEMBERSHIP_STATES.LEFT });
  });

  /* --------------------------------------------------------- publications */

  app.get('/publications/saved', (c) => {
    const { user, store: db, response } = guard(c);
    if (!user || !db) return response;
    const origin = originOf(c);
    return c.json({
      items: db.savedFeed(user.id).map((view) => serve(view, origin)),
    });
  });

  app.get('/publications', (c) => {
    const { user, store: db, response } = guard(c);
    if (!user || !db) return response;

    const scopeParam = c.req.query('scope') ?? 'shared';
    const scope =
      scopeParam === 'public' ? 'public' : scopeParam === 'mine' ? 'mine' : 'shared';
    const communityId = c.req.query('community') ?? undefined;

    /*
     * A community filter is checked before the feed runs, so an id someone
     * guessed cannot be used to probe for a community's existence through an
     * empty-versus-forbidden difference in the answer.
     */
    if (communityId && !activeMembership(db, communityId, user.id)) {
      return c.json({ error: 'No community found.' }, 404);
    }

    /*
     * A hashtag is a filter and nothing else. It is canonicalised and handed to
     * the query as one more `AND`, evaluated inside the same statement as the
     * visibility predicate — so a tag can only ever *narrow* what a viewer was
     * already entitled to, and can never widen it.
     */
    const rawTag = c.req.query('tag') ?? '';
    const [parsed] = rawTag ? parseHashtags([rawTag]) : [];

    const origin = originOf(c);
    const items = db.feed(user.id, {
      scope,
      query: (c.req.query('q') ?? '').trim() || undefined,
      tag: parsed?.tag,
      communityId,
    });

    return c.json({
      scope,
      items: items.map((view) => serve(view, origin)),
      hashtags: db.hashtagsFor(user.id, scope),
      reportReasons: PUBLICATION_REPORT_REASONS,
    });
  });

  /**
   * Publish a reflection to exactly one audience.
   *
   * Two rules are enforced here and are worth naming, because both fail
   * quietly:
   *
   *  - **One audience.** The request carries one `audience`, and a list of
   *    communities is refused rather than helpfully turned into something. If
   *    an author wants several communities, the answer is several
   *    publications, and the interface says so.
   *  - **Community sharing is never converted to public.** There is no branch
   *    in this handler that changes a requested `community` audience into
   *    `public` — not when the community is closed, not when the author picks
   *    several, not as a fallback when something is missing. A request that
   *    cannot be honoured as asked is refused, because publishing to a wider
   *    audience than the author chose is the worst possible failure mode.
   */
  app.post('/publications', async (c) => {
    const { user, store: db, response } = guard(c);
    if (!user || !db) return response;

    type PublishBody = {
      conversationId?: string;
      audience?: string;
      communityId?: string | null;
      communityIds?: unknown;
      caption?: string;
      sections?: unknown;
      hashtags?: unknown;
    };
    const body = await c.req.json<PublishBody>().catch((): PublishBody => ({}));

    if (Array.isArray(body.communityIds) && body.communityIds.length > 1) {
      /*
       * The system *may* suggest publishing publicly when several communities
       * are chosen. It may never do it. So this is a refusal carrying a
       * suggestion, and the decision stays with the author.
       */
      return c.json(
        {
          error:
            'A publication reaches one audience. Share to one community, then share again to the next — each keeps its own caption, reactions and date.',
          suggestion: 'publish_separately',
        },
        400,
      );
    }

    const conversationId = String(body.conversationId ?? '');
    if (!conversationId) return c.json({ error: 'conversationId is required.' }, 400);

    const audience = body.audience;
    if (!isAudience(audience)) return c.json({ error: 'Unknown audience.' }, 400);

    const source = reflection(user.id, conversationId);
    if (!source) return c.json({ error: 'Reflection not found.' }, 404);

    let communityId: string | null = null;
    if (audience === AUDIENCES.COMMUNITY) {
      communityId = body.communityId ? String(body.communityId) : null;
      if (!communityId) {
        return c.json({ error: 'Choose the community to share with.' }, 400);
      }
      /*
       * The author must be an active member of the community they publish to,
       * checked now rather than trusted from whatever the picker showed.
       */
      const membership = activeMembership(db, communityId, user.id);
      if (!membership) return c.json({ error: 'No community found.' }, 404);
      if (membership.mutedAt !== null) {
        return c.json({ error: 'You cannot publish in this community at the moment.' }, 403);
      }
    }

    /*
     * The same gate the reflection editor's publish button passes. A
     * publication that could not be a valid C.H.A.T. does not become one by
     * being shared, and the structured report says which field is at fault.
     */
    const validation = validateChat(
      source.format === CHAT_FORMATS.CONDENSED ? CHAT_FORMATS.CONDENSED : CHAT_FORMATS.FULL,
      {
        title: source.title,
        scriptureReference: source.scriptureReference ?? '',
        ...Object.fromEntries(
          Object.entries(source.sections).map(([type, section]) => [type, section.content]),
        ),
      },
      { extensionAcknowledged: c.req.query('acknowledgeExtension') === 'true' },
    );
    if (!validation.publishable) {
      return c.json({ error: 'This reflection is not ready to share.', validation }, 422);
    }

    const caption = String(body.caption ?? '').trim();
    if (caption.length > CAPTION_MAX) {
      return c.json(
        {
          error: `A caption is at most ${CAPTION_MAX} characters.`,
          validation: { field: 'caption', length: caption.length, hard: CAPTION_MAX },
        },
        422,
      );
    }

    /*
     * Which sections appear is the publication's business.
     *
     * The chosen list is copied into the publication's own rows and no write is
     * issued against the reflection — choosing what to show must not mutate the
     * source. Defaulting to everything written keeps the common case one press.
     */
    const requested = Array.isArray(body.sections)
      ? (body.sections as unknown[]).map((type) => String(type))
      : Object.keys(source.sections);
    const available = new Set(
      Object.entries(source.sections)
        .filter(([, section]) => section.content.trim().length > 0)
        .map(([type]) => type),
    );
    const sectionTypes = requested.filter((type) => available.has(type));
    if (sectionTypes.length === 0) {
      return c.json({ error: 'Choose at least one section to share.' }, 400);
    }

    ensureIdentity(user);
    const id = db.publish(
      {
        authorUserId: user.id,
        conversationId,
        audience: audience as Audience,
        communityId,
        caption,
        sectionTypes,
        hashtags: parseHashtags(
          Array.isArray(body.hashtags)
            ? (body.hashtags as unknown[]).map((tag) => String(tag))
            : String(body.hashtags ?? ''),
        ),
      },
      source,
    );

    const view = db.publication(user.id, id);
    if (!view) return c.json({ error: 'Publication could not be read back.' }, 500);
    return c.json(serve(view, originOf(c)), 201);
  });

  /**
   * One publication, with membership re-checked on this request.
   *
   * This is the endpoint the "an old URL does not preserve access" rule lives
   * or dies on, and it survives it by having nothing to preserve: the id in the
   * path is matched inside a statement that also asks whether this viewer holds
   * an active membership right now. A URL is not a capability here.
   */
  app.get('/publications/:id', (c) => {
    const { user, store: db, response } = guard(c);
    if (!user || !db) return response;

    const view = db.publication(user.id, c.req.param('id'));
    if (!view) return c.json({ error: 'This publication is not available.' }, 404);
    return c.json(serve(view, originOf(c)));
  });

  /** Fetch through the authorised read, or 404. Every write below starts here. */
  const visible = (db: CommunityStore, userId: string, id: string) =>
    db.publication(userId, id);

  app.post('/publications/:id/encouraged', async (c) => {
    const { user, store: db, response } = guard(c);
    if (!user || !db) return response;

    const id = c.req.param('id');
    const view = visible(db, user.id, id);
    if (!view) return c.json({ error: 'This publication is not available.' }, 404);

    const body = await c.req
      .json<{ encouraged?: boolean }>()
      .catch(() => ({}) as { encouraged?: boolean });
    /* Absent means toggle; explicit means set. Either way, at most one. */
    const next = body.encouraged ?? !view.encouragedByViewer;
    db.setEncouraged(id, user.id, next);

    const after = db.publication(user.id, id);
    return c.json({
      encouraged: {
        count: after?.encouragedCount ?? 0,
        byViewer: after?.encouragedByViewer ?? false,
      },
      /* Said plainly, for the screen-reader announcement the brief requires. */
      message: next ? 'You encouraged this reflection.' : 'Encouragement removed.',
    });
  });

  app.post('/publications/:id/save', async (c) => {
    const { user, store: db, response } = guard(c);
    if (!user || !db) return response;

    const id = c.req.param('id');
    const view = visible(db, user.id, id);
    if (!view) return c.json({ error: 'This publication is not available.' }, 404);

    const body = await c.req.json<{ saved?: boolean }>().catch(() => ({}) as { saved?: boolean });
    const next = body.saved ?? !view.savedByViewer;
    db.setSaved(id, user.id, next);

    /*
     * The answer describes only the asker's own bookmark. No count is returned
     * because none is computed: the author must never learn who saved their
     * work or how many did.
     */
    return c.json({
      saved: next,
      message: next ? 'Saved to your private collection.' : 'Removed from your saved items.',
    });
  });

  app.post('/publications/:id/report', async (c) => {
    const { user, store: db, response } = guard(c);
    if (!user || !db) return response;

    const id = c.req.param('id');
    const view = visible(db, user.id, id);
    if (!view) return c.json({ error: 'This publication is not available.' }, 404);

    const body = await c.req
      .json<{ reason?: string; detail?: string }>()
      .catch(() => ({}) as { reason?: string; detail?: string });
    if (!isReportReason(body.reason)) {
      return c.json({ error: 'Choose a reason for the report.', field: 'reason' }, 400);
    }

    db.addReport({
      publicationId: id,
      reporterUserId: user.id,
      reason: body.reason,
      detail: String(body.detail ?? '').slice(0, 500),
    });

    /*
     * **A report does not auto-hide.** Nothing about the publication changes
     * here — no moderation state is written, no visibility is touched. Reports
     * are reviewed before action, and the response says so rather than letting
     * the interface imply an instant takedown.
     */
    return c.json(
      {
        ok: true,
        hidden: false,
        message: 'Thank you. This has been reported and will be reviewed.',
      },
      201,
    );
  });

  /**
   * Hide, and unhide. A moderator's action, and reversible.
   *
   * Hiding takes a publication out of the community's view; it does not delete
   * anything, and it does not touch the report. That separation is the point:
   * an owner or moderator can stop something being seen without being able to
   * erase the evidence a review depends on.
   */
  app.post('/publications/:id/hide', async (c) => {
    const { user, store: db, response } = guard(c);
    if (!user || !db) return response;

    const id = c.req.param('id');
    const row = db.raw(id);
    if (!row || row.deletedAt !== null) {
      return c.json({ error: 'This publication is not available.' }, 404);
    }

    /*
     * A moderator of the community it was published to, or the author. Checked
     * against the live membership, not against who hid something before.
     */
    const membership = row.communityId
      ? activeMembership(db, row.communityId, user.id)
      : null;
    const permitted =
      row.authorUserId === user.id || (membership !== null && canModerate(membership.role));
    if (!permitted) {
      /* 404 rather than 403 — see the note at the top of this file. */
      return c.json({ error: 'This publication is not available.' }, 404);
    }

    const body = await c.req
      .json<{ hidden?: boolean }>()
      .catch(() => ({}) as { hidden?: boolean });
    const hidden = body.hidden ?? row.moderationState !== MODERATION_STATES.HIDDEN;
    db.setHidden(id, user.id, hidden);
    return c.json({
      moderationState: hidden ? MODERATION_STATES.HIDDEN : MODERATION_STATES.VISIBLE,
      message: hidden
        ? 'Hidden from the community. It has not been deleted.'
        : 'Visible to the community again.',
    });
  });

  /**
   * The author unshares their own publication.
   *
   * Refused while a report against it is open — that is the whole reason
   * deletion is a tombstone and hiding is a separate state. The refusal offers
   * hiding instead, so the author is not stuck: they can stop it being seen
   * immediately while the review keeps what it needs.
   *
   * Note this deletes the *publication*, never the reflection it was made from.
   * The author's private source material is untouched by anything in this file.
   */
  app.delete('/publications/:id', (c) => {
    const { user, store: db, response } = guard(c);
    if (!user || !db) return response;

    const id = c.req.param('id');
    const row = db.raw(id);
    if (!row || row.deletedAt !== null || row.authorUserId !== user.id) {
      return c.json({ error: 'This publication is not available.' }, 404);
    }

    if (db.openReportCount(id) > 0) {
      return c.json(
        {
          error:
            'This publication is part of an open report and cannot be deleted yet. You can hide it from the community in the meantime.',
          canHide: true,
        },
        409,
      );
    }

    db.softDelete(id);
    return c.json({ id, deleted: true, reflectionKept: true });
  });

  return app;
}
