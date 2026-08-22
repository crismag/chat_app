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
  COMMUNITY_PRESETS,
  CHAT_FORMATS,
  COMMUNITY_LIMITS,
  COMMUNITY_ROLES,
  MEMBERSHIP_STATES,
  MODERATION_STATES,
  PUBLICATION_REPORT_REASONS,
  JOIN_POLICY,
  PRESET_SETTINGS,
  canApproveMembers,
  canModerate,
  canShareExternally,
  grantsAccess,
  isAudience,
  isCommunityRole,
  DISCOVERABILITY,
  REFLECTION_VISIBILITY,
  increasesExposure,
  isBanned,
  isPending,
  isReportReason,
  reportIsSubmittable,
  parseHashtags,
  readCommunityRole,
  readCommunitySettings,
  validateChat,
  type Audience,
  type MembershipState,
  type ReflectionVisibility,
} from '@chat/shared';
import { decideShare } from './share-limits.ts';
import { addressOf } from '../http/address.ts';
import { CAPABILITIES, isEnabled, unavailableReason, type Capability } from '../http/capabilities.ts';
import { OUTWARD_ACTIONS, OutwardLimits, type OutwardAction } from '../http/outward-limits.ts';
import type { CommunityStore, PublicationView } from './store.ts';

export type CommunityUser = {
  id: string;
  email: string;
  /** When the account was made, so a brand-new one is held to less. */
  createdAt?: string | null;
};

/**
 * What this module needs from the rest of the API, stated as functions.
 *
 * It never learns what a store is, which is what keeps the reflection side and
 * the community side separable — and, more usefully, makes it obvious that
 * publishing *reads* a reflection and never writes one.
 */
export type CommunityRouteOptions = {
  /** A registered account. Everything that writes requires one. */
  currentUser: (c: Context) => Promise<CommunityUser | null>;
  /**
   * Anybody with a session, guest included.
   *
   * Reading what is already public is not an account-only privilege: a guest
   * who can be handed a link to a public reflection can obviously read it, and
   * refusing to render it in the application while the link works is a
   * distinction without a difference. Writing is the line, not reading.
   */
  currentReader: (c: Context) => Promise<CommunityUser | null>;
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
  userIdByEmail: (email: string) => string | null | Promise<string | null>;
  /** Ensure the person has a public identity before their name is shown. */
  ensureIdentity: (user: CommunityUser) => { handle: string; displayName: string };
  /** Injected in tests so a ceiling can be reached without making 40 requests. */
  limits?: OutwardLimits;
};

/*
 * What a guest is told when they reach something an account is needed for.
 *
 * Not "sign in": they are signed in, as a guest, and the header shows their own
 * avatar while saying it. The sentence has to name the actual requirement and
 * the actual remedy, and it has to be true of somebody who already has a
 * session and some writing of their own saved under it.
 */
const GUEST_CANNOT =
  'This needs an account. Your reflections are saved already — creating an account keeps them and lets you take part here.';

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
    /*
     * The text, without whose hand was on the keyboard.
     *
     * `authorOrigin` is still stored — it is how a suggestion is distinguished
     * from accepted words while somebody is writing — but it does not travel
     * to a reader. Whether a person used assistance is theirs, not a property
     * of the reflection other people read, and a field served in the payload
     * is a field that is published whether or not anything renders it.
     */
    sections: view.sections.map(({ type, content }) => ({ type, content })),
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
  const { currentUser, currentReader, store, reflection, userIdByEmail, ensureIdentity } = options;

  /*
   * The outward surfaces are metered and switchable; private writing is
   * neither. Everything in this file publishes, joins or reacts, which is
   * exactly the set that has to survive somebody pointing a script at it.
   */
  const limits = options.limits ?? new OutwardLimits();

  /**
   * A capability that has been switched off answers 503 with a sentence.
   *
   * 503 rather than 403: this is not about who is asking. It says the feature
   * is unavailable for everybody right now, which is what a person needs to
   * know before they try three more times.
   */
  const switchedOff = (c: Context, capability: Capability) =>
    isEnabled(capability) ? null : c.json({ error: unavailableReason(capability) }, 503);

  /** Spend one outward action, or hand back the refusal to return. */
  const meter = (c: Context, action: OutwardAction, user: { id: string; createdAt?: string | null }) => {
    const created = user.createdAt ? Date.parse(user.createdAt) : NaN;
    const decision = limits.take(action, {
      userId: user.id,
      address: addressOf(c),
      accountAgeMs: Number.isFinite(created) ? Date.now() - created : null,
    });
    if (decision.allowed) return null;
    return c.json(
      { error: decision.message, retryAfterSeconds: decision.retryAfterSeconds },
      429,
    );
  };

  /**
   * Every route begins here: a session, and a store that can hold membership.
   *
   * Returning the reason rather than throwing means an unavailable Community
   * says so in a sentence the interface can show, instead of appearing broken.
   */
  const guard = async (c: Context) => {
    if (!store) return { user: null, store: null, response: c.json({ error: UNAVAILABLE }, 503) };
    const user = await currentUser(c);
    if (!user) {
      /*
       * A guest reaching a route that writes is refused for a different reason
       * than a stranger, and is told which — "sign in" is useless advice to
       * somebody already signed in as a guest, and it was what they were given.
       */
      const reader = await currentReader(c);
      return {
        user: null,
        store: null,
        response: reader
          ? c.json({ error: GUEST_CANNOT, code: 'ACCOUNT_REQUIRED' }, 403)
          : c.json({ error: 'Unauthenticated.' }, 401),
      };
    }
    return { user, store, response: null };
  };

  /**
   * For reading what is public. Nobody at all passes.
   *
   * Public means public. A first-time visitor arriving on a link to a public
   * reflection has no session yet, and answering them 401 puts a login wall in
   * front of something anybody may read — while the same words are readable to
   * anyone the link was forwarded to. Minting them a guest account instead
   * would be silent account creation, which this product does not do: an
   * identity is made when somebody keeps something, not when they read.
   *
   * So a reader with no session is given a viewer id that matches nothing.
   * Every clause of `VISIBLE_TO` that could widen what they see is a
   * comparison against that id — authorship, hides, mutes, membership — and
   * none of them can match, so what is left is exactly the public rows. The
   * absence of a session is expressed as a viewer who owns nothing and belongs
   * nowhere, rather than as a special case threaded through the queries.
   */
  const NOBODY = '';

  const readerGuard = async (c: Context) => {
    if (!store) {
      return {
        viewerId: NOBODY,
        registered: false,
        store: null,
        response: c.json({ error: UNAVAILABLE }, 503),
      };
    }
    const reader = await currentReader(c);
    const registered = reader !== null && (await currentUser(c)) !== null;
    return { viewerId: reader?.id ?? NOBODY, registered, store, response: null };
  };

  /* ---------------------------------------------------------- communities */

  app.get('/communities', async (c) => {
    const { user, store: db, response } = await guard(c);
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
    const { user, store: db, response } = await guard(c);
    if (!user || !db) return response;
    const off = switchedOff(c, CAPABILITIES.COMMUNITY_CREATION);
    if (off) return off;
    const limited = meter(c, OUTWARD_ACTIONS.COMMUNITY_CREATE, user);
    if (limited) return limited;

    const body = await c.req
      .json<{ name?: string; description?: string; preset?: string; settings?: unknown }>()
      .catch(
        () =>
          ({}) as { name?: string; description?: string; preset?: string; settings?: unknown },
      );

    const name = (body.name ?? '').trim();
    if (!name) return c.json({ error: 'A community needs a name.', field: 'name' }, 400);
    if (name.length > COMMUNITY_LIMITS.name) {
      return c.json(
        { error: `A name is at most ${COMMUNITY_LIMITS.name} characters.`, field: 'name' },
        400,
      );
    }
    const description = (body.description ?? '').trim().slice(0, COMMUNITY_LIMITS.description);

    /*
     * Public or Private is what somebody chooses; the four settings are what
     * gets stored. A community may then adjust one of them without having to
     * be renamed into a third category nobody can define.
     */
    const preset =
      body.preset === COMMUNITY_PRESETS.PUBLIC
        ? COMMUNITY_PRESETS.PUBLIC
        : COMMUNITY_PRESETS.PRIVATE;
    const settings = readCommunitySettings({
      ...PRESET_SETTINGS[preset],
      ...(body.settings as Record<string, unknown> | undefined),
    });

    ensureIdentity(user);
    const community = db.createCommunity({
      name,
      description,
      createdByUserId: user.id,
      settings,
    });
    return c.json(
      {
        id: community.id,
        name: community.name,
        description: community.description,
        settings: community.settings,
        role: COMMUNITY_ROLES.OWNER,
        memberCount: 1,
        closed: false,
      },
      201,
    );
  });

  /*
   * Communities somebody could find and ask about.
   *
   * Discoverability is not readability: this lists names and descriptions of
   * communities that chose to be findable, and nothing anybody wrote inside
   * one. A discoverable private group is exactly that combination -- a
   * newcomer can see it exists and ask, and sees no reflections until asked.
   */
  app.get('/communities/discover', async (c) => {
    /*
     * `discoverable` already restricts to `discoverability = 'public'` and to
     * communities that are not closed, so this is the publicly visible
     * directory by construction. A guest sees the same rows a registered
     * stranger sees, with their own membership state — which is always none.
     */
    const { viewerId, store: db, response } = await readerGuard(c);
    if (!db) return response;
    const query = c.req.query('q') ?? '';
    return c.json({
      communities: db.discoverable(viewerId, query).map((community) => ({
        id: community.id,
        name: community.name,
        description: community.description,
        settings: community.settings,
        memberCount: community.memberCount,
        /* What this person's own relationship to it is, and nothing about anybody else's. */
        state: community.memberState,
      })),
    });
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

  app.get('/communities/:id', async (c) => {
    const { user, store: db, response } = await guard(c);
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

  app.get('/communities/:id/members', async (c) => {
    const { user, store: db, response } = await guard(c);
    if (!user || !db) return response;

    const id = c.req.param('id');
    const membership = activeMembership(db, id, user.id);
    if (!membership) return c.json({ error: 'No community found.' }, 404);

    const moderator = canModerate(readCommunityRole(membership.role));
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
    const { user, store: db, response } = await guard(c);
    if (!user || !db) return response;

    const id = c.req.param('id');
    const membership = activeMembership(db, id, user.id);
    if (!membership) return c.json({ error: 'No community found.' }, 404);
    if (!canModerate(readCommunityRole(membership.role))) {
      return c.json({ error: 'Only owners and admins may invite.' }, 403);
    }

    const body = await c.req.json<{ email?: string }>().catch(() => ({}) as { email?: string });
    const email = (body.email ?? '').trim().toLowerCase();
    const invitedId = email ? await userIdByEmail(email) : null;
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
    /*
     * An invitation cannot undo a ban. This is the third way back in — after
     * joining an open community and asking again — and a ban that one admin
     * can reverse by accident, without knowing there was one, is not a ban.
     */
    if (isBanned(existing?.state)) {
      return c.json(
        { error: 'That person is banned from this community. Lift the ban first.' },
        409,
      );
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

  app.post('/communities/:id/invitations/accept', async (c) => {
    const { user, store: db, response } = await guard(c);
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
    const { user, store: db, response } = await guard(c);
    if (!user || !db) return response;

    const id = c.req.param('id');
    const subjectId = c.req.param('userId');
    const membership = activeMembership(db, id, user.id);
    if (!membership) return c.json({ error: 'No community found.' }, 404);
    if (!canModerate(readCommunityRole(membership.role))) {
      return c.json({ error: 'Only owners and admins may change memberships.' }, 403);
    }

    const subject = db.membership(id, subjectId);
    if (!subject) return c.json({ error: 'No such member.' }, 404);

    const body = await c.req
      .json<{ role?: string; state?: string }>()
      .catch(() => ({}) as { role?: string; state?: string });

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
      /*
       * Removed and banned are different decisions, and both are offered.
       * Removal says "not now" and leaves the door open; a ban closes it,
       * including against an invitation from somebody who was not part of
       * whatever happened.
       */
      const settable: string[] = [
        MEMBERSHIP_STATES.ACTIVE,
        MEMBERSHIP_STATES.REMOVED,
        MEMBERSHIP_STATES.BANNED,
      ];
      if (!settable.includes(body.state)) {
        return c.json({ error: 'A membership may be set active, removed or banned.' }, 400);
      }
      if (
        body.state !== MEMBERSHIP_STATES.ACTIVE &&
        subject.role === COMMUNITY_ROLES.OWNER &&
        db.ownerCount(id) <= 1
      ) {
        return c.json({ error: 'A community cannot be left without an owner.' }, 409);
      }
      state = body.state as MembershipState;
    }

    db.setMembership({
      communityId: id,
      userId: subjectId,
      role,
      state,
    });
    return c.json({ ok: true, role, state });
  });

  /**
   * Ask to join, or join outright where the community is open.
   *
   * One route for both, because from the asker's side it is one action: they
   * pressed Join. What differs is what the community said should happen next,
   * and that is the community's setting rather than a second endpoint the
   * client has to know to call.
   */
  app.post('/communities/:id/join', async (c) => {
    const { user, store: db, response } = await guard(c);
    if (!user || !db) return response;
    const off = switchedOff(c, CAPABILITIES.COMMUNITY_JOINING);
    if (off) return off;
    const limited = meter(c, OUTWARD_ACTIONS.COMMUNITY_JOIN, user);
    if (limited) return limited;

    const id = c.req.param('id');
    const community = db.community(id);
    /*
     * A hidden community answers 404 to somebody who is not in it, exactly as
     * it does for a read: being able to confirm that a private group exists is
     * the disclosure hiding it exists to prevent.
     */
    const existing = db.membership(id, user.id);
    const maySee =
      community &&
      (community.settings.discoverability === DISCOVERABILITY.PUBLIC || existing !== null);
    if (!community || !maySee) return c.json({ error: 'No community found.' }, 404);
    if (community.closedAt) return c.json({ error: 'That community is closed.' }, 409);

    /*
     * A ban survives the attempt to come back. It is answered as though the
     * community were not there, so a ban is not a thing to be argued with by
     * pressing the button again.
     */
    if (isBanned(existing?.state)) return c.json({ error: 'No community found.' }, 404);
    if (grantsAccess(existing?.state)) return c.json({ state: MEMBERSHIP_STATES.ACTIVE });
    /* One request, not one per press. */
    if (isPending(existing?.state)) return c.json({ state: MEMBERSHIP_STATES.PENDING });

    if (community.settings.joinPolicy === JOIN_POLICY.INVITE) {
      return c.json({ error: 'This community is invitation only.' }, 403);
    }

    ensureIdentity(user);
    const state =
      community.settings.joinPolicy === JOIN_POLICY.OPEN
        ? MEMBERSHIP_STATES.ACTIVE
        : MEMBERSHIP_STATES.PENDING;
    db.setMembership({
      communityId: id,
      userId: user.id,
      role: COMMUNITY_ROLES.MEMBER,
      state,
    });
    return c.json({ state }, 201);
  });

  /** Who is waiting, for the people who may decide. */
  app.get('/communities/:id/join-requests', async (c) => {
    const { user, store: db, response } = await guard(c);
    if (!user || !db) return response;

    const id = c.req.param('id');
    const membership = activeMembership(db, id, user.id);
    const community = membership ? db.community(id) : null;
    if (!membership || !community) return c.json({ error: 'No community found.' }, 404);
    if (!canApproveMembers(readCommunityRole(membership.role), community.settings.approvalPolicy)) {
      return c.json({ error: 'Only owners and admins may see join requests.' }, 403);
    }

    return c.json({
      requests: db.joinRequests(id).map((request) => ({
        userId: request.userId,
        handle: request.handle,
        displayName: request.displayName,
        requestedAt: request.updatedAt,
      })),
    });
  });

  /** Approve or decline one. Deciding is a role's job, not a member's, by default. */
  app.post('/communities/:id/join-requests/:userId', async (c) => {
    const { user, store: db, response } = await guard(c);
    if (!user || !db) return response;

    const id = c.req.param('id');
    const subjectId = c.req.param('userId');
    const membership = activeMembership(db, id, user.id);
    const community = membership ? db.community(id) : null;
    if (!membership || !community) return c.json({ error: 'No community found.' }, 404);
    if (!canApproveMembers(readCommunityRole(membership.role), community.settings.approvalPolicy)) {
      return c.json({ error: 'Only owners and admins may decide on join requests.' }, 403);
    }

    const subject = db.membership(id, subjectId);
    if (!subject || !isPending(subject.state)) {
      return c.json({ error: 'No request from that person.' }, 404);
    }

    const body = await c.req
      .json<{ decision?: string }>()
      .catch(() => ({}) as { decision?: string });
    if (body.decision !== 'approve' && body.decision !== 'decline') {
      return c.json({ error: 'Decide approve or decline.' }, 400);
    }
    /*
     * Declining is not banning. The person may ask again -- most declines are
     * "we do not know you yet" rather than "never".
     */
    const state =
      body.decision === 'approve' ? MEMBERSHIP_STATES.ACTIVE : MEMBERSHIP_STATES.REMOVED;
    db.setMembership({
      communityId: id,
      userId: subjectId,
      role: COMMUNITY_ROLES.MEMBER,
      state,
    });
    return c.json({ userId: subjectId, state });
  });

  /**
   * Change what the community is.
   *
   * The one change refused here is the one an administrator must not be able
   * to make on somebody else's behalf: turning members-only into public
   * applies to what is shared next, never to what is already there. The reply
   * says so, because a setting that silently means less than it appears to is
   * worse than one that is refused.
   */
  app.patch('/communities/:id/settings', async (c) => {
    const { user, store: db, response } = await guard(c);
    if (!user || !db) return response;

    const id = c.req.param('id');
    const membership = activeMembership(db, id, user.id);
    const community = membership ? db.community(id) : null;
    if (!membership || !community) return c.json({ error: 'No community found.' }, 404);
    if (readCommunityRole(membership.role) !== COMMUNITY_ROLES.OWNER) {
      return c.json({ error: 'Only an owner may change community settings.' }, 403);
    }

    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    const next = readCommunitySettings({ ...community.settings, ...body });
    db.updateSettings(id, next);

    return c.json({
      settings: next,
      /*
       * Said plainly rather than left to be discovered: the reflections that
       * are already there kept the visibility they were shared with.
       */
      ...(increasesExposure(community.settings, next)
        ? {
            existingSharesUnchanged: true,
            note: 'Reflections already shared here stay members-only. This applies to what is shared from now on.',
          }
        : {}),
    });
  });

  /**
   * Close a community.
   *
   * It takes the space, the memberships and this community's copies of what
   * was shared into it. It does not take anybody's reflections: a share was
   * never the reflection, and closing a room cannot be a way to delete other
   * people's writing.
   */
  app.delete('/communities/:id', async (c) => {
    const { user, store: db, response } = await guard(c);
    if (!user || !db) return response;

    const id = c.req.param('id');
    const membership = activeMembership(db, id, user.id);
    const community = membership ? db.community(id) : null;
    if (!membership || !community) return c.json({ error: 'No community found.' }, 404);
    if (readCommunityRole(membership.role) !== COMMUNITY_ROLES.OWNER) {
      return c.json({ error: 'Only an owner may delete a community.' }, 403);
    }

    db.deleteCommunity(id);
    return c.json({ id, deleted: true, reflectionsKept: true });
  });

  app.post('/communities/:id/leave', async (c) => {
    const { user, store: db, response } = await guard(c);
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

  app.get('/publications/saved', async (c) => {
    const { user, store: db, response } = await guard(c);
    if (!user || !db) return response;
    const origin = originOf(c);
    return c.json({
      items: db.savedFeed(user.id).map((view) => serve(view, origin)),
    });
  });

  app.get('/publications/encouraged', async (c) => {
    const { user, store: db, response } = await guard(c);
    if (!user || !db) return response;
    const origin = originOf(c);
    return c.json({
      items: db.encouragedFeed(user.id).map((view) => serve(view, origin)),
    });
  });

  app.get('/publications', async (c) => {
    const { viewerId, registered, store: db, response } = await readerGuard(c);
    if (!db) return response;

    const scopeParam = c.req.query('scope') ?? 'shared';
    const asked =
      scopeParam === 'public' ? 'public' : scopeParam === 'mine' ? 'mine' : 'shared';
    /*
     * A guest reads the public feed and only the public feed.
     *
     * Forced here rather than refused, because `public` is the only scope that
     * means anything to somebody with no memberships — `shared` is "the
     * communities you belong to" and `mine` is "what you published", and both
     * are empty for a guest by definition. Narrowing is safe in a way widening
     * would not be: `SCOPE_PUBLIC` is `audience = 'public'`, which no
     * membership can extend.
     */
    const scope = registered ? asked : 'public';
    const communityId = registered ? (c.req.query('community') ?? undefined) : undefined;

    /*
     * A community filter is checked before the feed runs, so an id someone
     * guessed cannot be used to probe for a community's existence through an
     * empty-versus-forbidden difference in the answer.
     */
    if (communityId && !activeMembership(db, communityId, viewerId)) {
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
    const items = db.feed(viewerId, {
      scope,
      query: (c.req.query('q') ?? '').trim() || undefined,
      tag: parsed?.tag,
      communityId,
    });

    return c.json({
      scope,
      items: items.map((view) => serve(view, origin)),
      hashtags: db.hashtagsFor(viewerId, scope),
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
    const { user, store: db, response } = await guard(c);
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

    /*
     * Switched off per audience, because they fail for different reasons and
     * one of them being abused is no reason to stop the other. `only_me` is
     * not an outward action at all and passes both of these.
     */
    if (audience === AUDIENCES.PUBLIC) {
      const off = switchedOff(c, CAPABILITIES.PUBLIC_SHARING);
      if (off) return off;
    }
    if (audience === AUDIENCES.COMMUNITY) {
      const off = switchedOff(c, CAPABILITIES.COMMUNITY_SHARING);
      if (off) return off;
    }

    const source = reflection(user.id, conversationId);
    if (!source) return c.json({ error: 'Reflection not found.' }, 404);

    let communityId: string | null = null;
    /*
     * Who will be able to read this share, decided here and kept on the row.
     *
     * A public publication is public. A community share takes the community's
     * current answer -- once -- so that a later change to the setting governs
     * the next share and never this one.
     */
    let shareVisibility: ReflectionVisibility = REFLECTION_VISIBILITY.PUBLIC;
    if (audience === AUDIENCES.COMMUNITY) {
      communityId = body.communityId ? String(body.communityId) : null;
      if (!communityId) {
        return c.json({ error: 'Choose the community to share with.' }, 400);
      }
      /*
       * The author must be an active member of the community they publish to,
       * checked now rather than trusted from whatever the picker showed.
       *
       * And that is the whole test. There is deliberately no owner-only mode,
       * no approved-author list and no per-member posting restriction:
       * membership includes the right to participate, and a community where
       * one person speaks and the others may only read has stopped being a
       * shared space. A community that does not want somebody posting removes
       * or bans them, which is a decision it has to make out loud.
       */
      const membership = activeMembership(db, communityId, user.id);
      const community = membership ? db.community(communityId) : null;
      if (!membership || !community) return c.json({ error: 'No community found.' }, 404);
      shareVisibility = community.settings.reflectionVisibility;
    }
    if (audience === AUDIENCES.ONLY_ME) shareVisibility = REFLECTION_VISIBILITY.MEMBERS;

    /*
     * How much this person may distribute, from what they have already
     * distributed — counted from a log that survives unsharing, so share,
     * unshare, share is not a way round it.
     *
     * `only_me` passes untouched: it reaches nobody, so it is not
     * distribution, and a person who has hit a ceiling can still keep writing
     * and keep their reflection exactly as it is.
     */
    if (audience !== AUDIENCES.ONLY_ME) {
      const created = user.createdAt ? Date.parse(user.createdAt) : NaN;
      const now = Date.now();
      const decision = decideShare(
        db.shareHistory({ userId: user.id, conversationId, communityId, now }),
        {
          audience: audience === AUDIENCES.PUBLIC ? 'public' : 'community',
          communityId,
          accountAgeMs: Number.isFinite(created) ? now - created : null,
        },
        now,
      );
      if (!decision.allowed) {
        return c.json(
          {
            error: decision.message,
            refusal: decision.refusal,
            retryAfterSeconds: decision.retryAfterSeconds,
          },
          429,
        );
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
    if (!validation.shareable) {
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

    const hashtags = parseHashtags(
      Array.isArray(body.hashtags)
        ? (body.hashtags as unknown[]).map((tag) => String(tag))
        : String(body.hashtags ?? ''),
    );

    /*
     * One share per destination. Sharing the same reflection into the same
     * community again is not a second share — it is the author saying "use
     * what it says now" — so the existing row is brought up to date and keeps
     * its reactions, its saves and its date. Writing another row instead is
     * how a feed fills with three copies of one reflection.
     */
    const already = db.existingShare({
      authorUserId: user.id,
      conversationId,
      audience,
      communityId,
    });
    if (already) {
      db.refreshShare(already, { caption, sectionTypes, hashtags }, source);
      const updated = db.publication(user.id, already);
      if (!updated) return c.json({ error: 'Publication could not be read back.' }, 500);
      /*
       * No share event is recorded. Nothing new was distributed, and counting
       * it would let a limit be spent by pressing Share twice on one thing.
       */
      return c.json({ ...serve(updated, originOf(c)), alreadyShared: true });
    }

    /*
     * The share event is recorded inside publish(), in the same transaction as
     * the publication. It is never removed: the ceilings count shares made,
     * which is why unsharing does not refund one.
     */
    const id = db.publish(
      {
        authorUserId: user.id,
        conversationId,
        audience: audience as Audience,
        shareVisibility,
        communityId,
        caption,
        sectionTypes,
        hashtags,
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
  app.get('/publications/:id', async (c) => {
    /*
     * Open to a guest, and no extra filtering is needed to make that safe:
     * `VISIBLE_TO` admits a publication only if the reader wrote it, or it is
     * public, or it is a community share explicitly made public at publish
     * time, or they are an active member. A guest is a member of nothing, so
     * member-only content is refused by the same predicate that has always
     * refused it — this widens who may ask, not what the answer can be.
     */
    const { viewerId, store: db, response } = await readerGuard(c);
    if (!db) return response;

    const view = db.publication(viewerId, c.req.param('id'));
    if (!view) return c.json({ error: 'This publication is not available.' }, 404);
    return c.json(serve(view, originOf(c)));
  });

  /** Fetch through the authorised read, or 404. Every write below starts here. */
  const visible = (db: CommunityStore, userId: string, id: string) =>
    db.publication(userId, id);

  app.post('/publications/:id/encouraged', async (c) => {
    const { user, store: db, response } = await guard(c);
    if (!user || !db) return response;
    const limited = meter(c, OUTWARD_ACTIONS.REACT, user);
    if (limited) return limited;

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
    const { user, store: db, response } = await guard(c);
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

  /*
   * Out of my sight, please. Not a report, and not a moderation decision.
   *
   * It takes effect on the next request because the reader's own filters live
   * inside the same statement that authorises the read — there is nothing to
   * wait for and nobody to agree. The author is not told, and nothing about
   * the publication changes for anybody else.
   */
  app.post('/publications/:id/hide-for-me', async (c) => {
    const { user, store: db, response } = await guard(c);
    if (!user || !db) return response;

    const id = c.req.param('id');
    const body = await c.req.json<{ hidden?: boolean }>().catch(() => ({}) as { hidden?: boolean });
    const hidden = body.hidden !== false;

    /*
     * Reachable first: you cannot hide what you were not entitled to see.
     *
     * Only when hiding, though. Something already hidden is by construction
     * unreadable to this person — that is what hiding did — so requiring it to
     * be readable in order to un-hide it would make the decision permanent,
     * which is the one thing a personal control must not be.
     */
    if (hidden && !db.publication(user.id, id)) {
      return c.json({ error: 'Publication not found.' }, 404);
    }
    db.hidePublicationForViewer(id, user.id, hidden);
    return c.json({ id, hiddenForYou: hidden });
  });

  /** The same, for everything one person shares. Also nobody else's business. */
  app.post('/publications/:id/mute-author', async (c) => {
    const { user, store: db, response } = await guard(c);
    if (!user || !db) return response;

    const id = c.req.param('id');
    const view = db.publication(user.id, id);
    if (!view) return c.json({ error: 'Publication not found.' }, 404);
    if (view.isAuthor) {
      return c.json({ error: 'That is your own reflection.' }, 400);
    }

    const author = db.authorOf(id);
    if (!author) return c.json({ error: 'Publication not found.' }, 404);
    const body = await c.req.json<{ muted?: boolean }>().catch(() => ({}) as { muted?: boolean });
    const muted = body.muted !== false;
    db.muteAuthor(user.id, author, muted);
    return c.json({ muted });
  });

  app.post('/publications/:id/report', async (c) => {
    const { user, store: db, response } = await guard(c);
    if (!user || !db) return response;
    const limited = meter(c, OUTWARD_ACTIONS.REPORT, user);
    if (limited) return limited;

    const id = c.req.param('id');
    const view = visible(db, user.id, id);
    if (!view) return c.json({ error: 'This publication is not available.' }, 404);

    const body = await c.req
      .json<{ reason?: string; detail?: string }>()
      .catch(() => ({}) as { reason?: string; detail?: string });
    if (!isReportReason(body.reason)) {
      return c.json({ error: 'Choose a reason for the report.', field: 'reason' }, 400);
    }
    /*
     * "Something else" needs a sentence. A report that says only "none of
     * these" cannot be acted on by anybody, and asking for the sentence is
     * also a small brake on reporting somebody in a temper.
     */
    if (!reportIsSubmittable(body.reason, String(body.detail ?? ''))) {
      return c.json(
        { error: 'Tell us what is wrong, in a sentence or two.', field: 'detail' },
        400,
      );
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
    const { user, store: db, response } = await guard(c);
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
      row.authorUserId === user.id || (membership !== null && canModerate(readCommunityRole(membership.role)));
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
  app.delete('/publications/:id', async (c) => {
    const { user, store: db, response } = await guard(c);
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
