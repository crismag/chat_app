import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { sessionCookieOptions } from './auth/session-cookie.ts';
import { SqliteAuthStore, type AuthStore, type AuthUser } from './auth/store.ts';
import {
  PERSISTENCE_TYPES,
  SESSION_TYPES,
  clearInstallationCookie,
  createGuest,
  deviceClassFromRequest,
  recognisedAccount,
  rememberInstallation,
  sessionTypeFor,
} from './auth/identity.ts';
import { AnonymousAiAllowance } from './ai/anonymous-allowance.ts';
import { CAPABILITIES, isEnabled, unavailableReason } from './http/capabilities.ts';
import { hashPassword, verifyPassword } from './auth/local-password.ts';
import { webOrigins } from './http/origins.ts';
import {
  AUTHOR_ORIGINS,
  CHAT_FORMATS,
  CHAT_SECTION_TYPES,
  CONDENSED_SECTION_TYPES,
  FORMAT_LIMITS,
  validateChat,
  type AuthorOrigin,
  type ChatFormat,
  AI_ACTIONS,
  CREATE_LAYOUTS,
  CREATE_STYLES,
  VISIBILITY,
  TITLE_SOURCES,
  type AiAction,
  type CreateLayout,
  type CreateStyle,
  type HealthResponse,
  ACCOUNT_TYPES,
  CREATION_METHODS,
  CREATION_SOURCES,
  readCreationContext,
  type CreationSource,
} from '@chat/shared';
import {
  aiStatus,
  applyNamedAiAction,
  condensedFromStore,
  extractChatSections,
  sectionsFromStore,
  suggestTitles,
} from './ai.ts';
import { createAiRoutes } from './ai/routes.ts';
import { AiService, type AiServiceOptions } from './ai/service.ts';
import { createBibleRoutes } from './bible/routes.ts';
import { createPassageStore } from './bible/passage-store.ts';
import { BibleService } from './bible/service.ts';
import { createProfileRoutes, ensureProfile } from './profile/routes.ts';
import { createProfileStore } from './profile/store.ts';
import { createCommunityRoutes } from './community/routes.ts';
import { createCommunityStore } from './community/store.ts';
import { createStudioCreationStore } from './create/store.ts';
import { readStudioCreation } from './create/validation.ts';
import { createStudioImageRoutes } from './create/image-routes.ts';
import { createStudioImageAssetStore } from './create/image-store.ts';
import type { StudioImageProvider } from './create/image-provider.ts';
import { SqliteStore } from './db.ts';
import { MemoryStore, type StoredConversation } from './store.ts';
import { BOOKS } from './bible/books.ts';
import { matchesReflection, readReflectionFilters } from './reflections/query.ts';
import { parseScriptureQuery } from './reflections/scripture-query.ts';
import { readStoredTags } from './reflections/tags.ts';

const SESSION_COOKIE = 'chat_session';


function nowIso(): string {
  return new Date().toISOString();
}

function summaryOf(conversation: StoredConversation) {
  return {
    id: conversation.id,
    format: conversation.format,
    title: conversation.title,
    scriptureReference: conversation.scriptureReference,
    visibility: conversation.visibility,
    tags: conversation.tags ?? [],
    updatedAt: conversation.updatedAt,
  };
}

function tagFacets(conversations: StoredConversation[]) {
  const counts = new Map<string, { tag: string; label: string; count: number }>();
  for (const conversation of conversations) {
    for (const item of conversation.tags ?? []) {
      const current = counts.get(item.tag);
      if (current) {
        current.count += 1;
      } else {
        counts.set(item.tag, { tag: item.tag, label: item.label, count: 1 });
      }
    }
  }
  return [...counts.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function bookFacets(conversations: StoredConversation[]) {
  const counts = new Map<string, number>();
  for (const conversation of conversations) {
    const locator = conversation.scriptureReference
      ? parseScriptureQuery(conversation.scriptureReference)
      : null;
    if (!locator) continue;
    counts.set(locator.book, (counts.get(locator.book) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([usfm, count]) => ({
      usfm,
      name: BOOKS.find((book) => book.usfm === usfm)?.name ?? usfm,
      count,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Every field name a section row may carry, for validating a write. */
const SECTION_TYPES = [
  ...Object.values(CHAT_SECTION_TYPES),
  ...Object.values(CONDENSED_SECTION_TYPES),
] as const;

type SectionType = (typeof SECTION_TYPES)[number];

const AUTHOR_ORIGIN_VALUES = Object.values(AUTHOR_ORIGINS) as readonly AuthorOrigin[];

/**
 * `store` accepts either backing. Tests hand in an in-memory SQLite database so
 * each one gets a clean schema; the server hands in a file.
 *
 * `ai` lets a test hand in a fake provider.
 *
 * Assistance is constructed here rather than imported as a singleton so a test
 * can give this app its own service — with its own provider, its own clock and
 * its own rate limiter — without any of them leaking into the next test.
 */
export function createApp(
  store: MemoryStore | SqliteStore = new SqliteStore(),
  ai: AiServiceOptions = {},
  studioImages: { provider?: StudioImageProvider } = {},
  /*
   * Where accounts live. Defaults to the SQLite tables so a checkout with no
   * database still runs and the suite still passes without one; `index.ts`
   * hands in the MariaDB store when MYSQL_* is configured.
   */
  auth: AuthStore = new SqliteAuthStore(store, hashPassword, verifyPassword),
) {
  const app = new Hono();
  const aiService = new AiService(ai);
  /* One allowance for the life of the process, like the other rate limiters. */
  const anonymousAllowance = new AnonymousAiAllowance();
  const bibleService = new BibleService();
  const biblePassages = createPassageStore(store);
  const studioCreations = createStudioCreationStore(store);
  const studioImageAssets = createStudioImageAssetStore(store);

  /**
   * The draft as its format's validator expects to see it.
   *
   * A Full C.H.A.T. is validated on its four sections; a Condensed one on its
   * verse and reflection. Building it in one place is what stops a Condensed
   * reflection being judged against Full's rules — which is how a format switch
   * quietly starts reporting the wrong field.
   */
  const draftOf = (conversation: StoredConversation): Record<string, unknown> => {
    const stored = store.sections.get(conversation.id);
    const base = {
      title: conversation.title,
      scriptureReference: conversation.scriptureReference ?? '',
    };
    if (conversation.format === CHAT_FORMATS.CONDENSED) {
      const condensed = condensedFromStore(stored);
      return {
        ...base,
        verse: condensed.verse.content,
        reflection: condensed.reflection.content,
      };
    }
    const sections = sectionsFromStore(stored);
    return {
      ...base,
      content: sections.content.content,
      heart: sections.heart.content,
      application: sections.application.content,
      testimony: sections.testimony.content,
    };
  };

  app.use(
    '/api/*',
    cors({
      origin: webOrigins(),
      allowMethods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
    }),
  );

  /*
   * Asynchronous, because accounts are in MariaDB now.
   *
   * That is the whole reason the earlier "one synchronous store interface"
   * idea could not work: node:sqlite is synchronous and mysql2 is not, so a
   * seam either awaits or it can only ever have one implementation.
   */
  const currentUser = async (c: Context) => auth.userForToken(getCookie(c, SESSION_COOKIE) ?? '');

  /**
   * Begin a session and put its token where the browser will send it back.
   *
   * `persistent` is about the cookie, not the row: an unticked "keep me signed
   * in" gets a cookie with no Max-Age, so it goes when the browser closes.
   */
  const beginSession = async (
    c: Context,
    user: AuthUser,
    options: { installationId?: string | null; persistent: boolean },
  ) => {
    const token = await auth.startSession(user.id, {
      installationId: options.installationId ?? null,
      sessionType: sessionTypeFor(user, options.persistent),
    });
    setCookie(
      c,
      SESSION_COOKIE,
      token,
      sessionCookieOptions(c.req.header('origin'), process.env, options.persistent),
    );
    return token;
  };

  const requireUser = async (c: Parameters<typeof currentUser>[0]) => currentUser(c);

  /*
   * Whoever this request is for: the signed-in account, else the guest their
   * credential names, else nobody.
   *
   * Nobody is an ordinary answer. A visitor reading a shared reflection is
   * nobody, and no account is created to serve them -- that only happens when
   * somebody asks for one at /api/auth/guest.
   */
  /**
   * Whoever this request is for: the session, else the browser's durable
   * recognition, else nobody.
   *
   * The second step is what makes recognition survive a session ending: a
   * browser holding a live installation credential is silently given a new
   * session rather than being asked to sign in again. Nobody is still an
   * ordinary answer -- a visitor reading a shared reflection is nobody, and no
   * account is created to serve them.
   */
  const currentAccount = async (c: Context): Promise<AuthUser | null> => {
    const signedIn = await currentUser(c);
    if (signedIn) return signedIn;
    const recognised = await recognisedAccount(c, auth);
    if (!recognised) return null;
    /*
     * Renewal is invisible, and persistent: this browser is durably recognised
     * already, so a session cookie that died with the window would just be
     * re-minted on the next request.
     */
    await beginSession(c, recognised.user, {
      installationId: recognised.installationId,
      persistent: true,
    });
    return recognised.user;
  };

  /*
   * What the client is told about whoever it is talking to.
   *
   * One shape for both kinds. The client shows "Guest · QuietCedar-14" or an
   * email from the same payload rather than calling two endpoints and
   * inferring which sort of person came back.
   */
  const accountBody = (account: AuthUser) => ({
    id: account.id,
    accountType: account.accountType,
    email: account.email,
    guestName: account.guestName,
    emailVerified: account.emailVerified,
  });

  /*
   * The refusal that means "choose how to be somebody", not "go away".
   *
   * `needsAccount` is what the client keys on: it opens the guest-or-sign-in
   * choice and retries the action afterwards, so nothing the person had
   * written is lost to the interruption. `creationSource` travels back with
   * the choice so the resulting account records where it was made.
   */
  const accountRequired = (creationSource: CreationSource) => ({
    error: 'Saving this needs an account — continue as a guest, or sign in.',
    needsAccount: true,
    creationSource,
  });

  /** How much a guest would be bringing with them. Used to say so plainly. */
  const reflectionsOwnedBy = (userId: string) =>
    [...store.conversations.values()].filter((conversation) => conversation.userId === userId).length;

  /*
   * The parts of the application that still need an email behind them.
   *
   * Community sharing puts a name next to somebody's writing where other
   * people can see it, and a profile is that name. Those want a registered
   * account; the private work of writing a reflection does not, which is the
   * distinction this function exists to keep.
   */
  const registeredUser = async (c: Context) => {
    const user = await currentUser(c);
    /* `createdAt` travels: the distribution limits are tighter on day one. */
    return user?.email
      ? { id: user.id, email: user.email, createdAt: user.createdAt }
      : null;
  };

  app.get('/api/health', async (c) => {
    const body: HealthResponse = {
      status: 'ok',
      service: 'chat-api',
      timestamp: nowIso(),
    };
    return c.json(body);
  });

  /*
   * What assistance can do right now — one endpoint, extended rather than
   * duplicated.
   *
   * The interface asks before it offers a control, so an unavailable one can
   * be disabled with a reason on it rather than left live and doing nothing.
   * The model-backed capabilities are reported by the AI service; the
   * heuristic title suggestion that predates it keeps reporting through
   * `aiStatus()`, and the two are merged into the one answer the client
   * already reads. Nothing here names a project, a model, a key or a quota.
   */
  app.route(
    '/api/ai',
    createAiRoutes({
      service: aiService,
      currentUser: (c) => currentUser(c),
      /*
       * Assistance without an account: a small daily allowance rather than a
       * closed door. It is the one feature billed per call, so a visitor gets
       * enough to see what it does and an account is what makes it ordinary.
       */
      currentOwner: (c) => currentAccount(c),
      anonymousAllowance,
      /*
       * The server builds the chat's context; the client never describes it.
       *
       * A request carries a conversation id and a message, and everything else
       * — the passage, the sections, the thread — is loaded here from a
       * reflection this user is proved to own. A client that could describe its
       * own context could describe somebody else's.
       */
      conversation: {
        load: (userId, conversationId) => {
          const conversation = store.conversations.get(conversationId);
          if (!conversation || !userOwnsConversation(userId, conversation.id)) return null;

          const stored = sectionsFromStore(store.sections.get(conversationId));
          const sections: Record<string, string> = {};
          for (const [type, section] of Object.entries(stored)) {
            if (section.content.trim()) sections[type] = section.content;
          }

          /*
           * The passage's own words, through the Bible connector's seam.
           *
           * `scriptureForPrompt` is the only thing allowed to decide whether a
           * translation's text may be sent to a third party, and it is also
           * what reports an absence as an absence. Both answers matter: with
           * the words, the model quotes what the writer actually chose; with
           * `unavailable`, the prompt forbids it reconstructing a verse from
           * memory and naming a translation for it. Reaching past this call to
           * the stored passage would quietly opt out of both.
           */
          const scripture = bibleService.scriptureForPrompt(
            biblePassages.get(conversationId),
            conversation.scriptureReference ?? '',
          );

          return {
            passageReference: conversation.scriptureReference ?? '',
            ...(scripture.text === undefined
              ? {}
              : {
                  passageText: scripture.text,
                  ...(scripture.abbreviation ? { passageAbbreviation: scripture.abbreviation } : {}),
                }),
            sections,
            history: (store.messages.get(conversationId) ?? []).map((message) => ({
              role: message.role,
              content: message.content,
            })),
          };
        },
        appendAssistantMessage: (conversationId, content, draft) => {
          const conversation = store.conversations.get(conversationId);
          const message = {
            id: randomUUID(),
            conversationId,
            role: 'assistant' as const,
            content,
            originalContent: content,
            /*
             * The draft rides on the reply, and its destination was decided by
             * `resolveDraftTarget` in trusted code — never by the model. Null is
             * a legitimate value: an unplaced draft is still a draft.
             */
            draftText: draft?.text ?? null,
            draftSection: draft?.section ?? null,
            /*
             * `ai_generated`, not `ai_assisted`. The model wrote every word of
             * this, and the badge on it has to keep saying so — including if
             * the author later carries it into a section, where the provenance
             * travels with the text rather than being reset by the move.
             */
            authorOrigin: AUTHOR_ORIGINS.AI_GENERATED,
            createdAt: nowIso(),
          };
          store.messages.append(conversationId, message);
          if (conversation) {
            conversation.updatedAt = message.createdAt;
            store.conversations.set(conversationId, conversation);
          }
          return message;
        },
      },
      status: () => {
        /*
         * Two independent facts, reported as one answer.
         *
         * The heuristic path needs no key and no network, so a server with no
         * provider configured must still report `enabled` — otherwise the
         * Suggest-title button that has worked since before any of this stops
         * working the moment the AI backbone lands, which would be a
         * regression dressed as a feature.
         */
        const heuristic = aiStatus();
        const model = aiService.modelStatus();
        return {
          enabled: heuristic.enabled,
          provider: model.available ? model.provider : heuristic.provider,
          capabilities: {
            suggestTitle: heuristic.enabled,
            reflectionGuidance: heuristic.enabled && model.available,
            improveWriting: heuristic.enabled && model.available,
            /*
             * False does not mean the composer stops working. It means it
             * stops expecting a reply — messages are still written down, and
             * the interface says they are notes to self rather than pretending
             * an answer is on its way.
             */
            reflectionChat: heuristic.enabled && model.available,
          },
          ...(heuristic.enabled
            ? model.available
              ? {}
              : { reason: model.reason }
            : { reason: heuristic.reason }),
        };
      },
    }),
  );

  /*
   * Bible passage lookup, mounted and nothing more.
   *
   * The connector owns its own configuration, its own caches, its own storage
   * and its own migration, so mounting it is the whole of its footprint in this
   * file. `ownsConversation` is passed in rather than reached for, because the
   * connector must never learn what a store is — and because who owns a
   * reflection is this file's fact to state, not a connector's.
   */
  app.route(
    '/api/bible',
    createBibleRoutes({
      service: bibleService,
      /* Scripture is reachable without an account; the reflection it is saved
       * against still is not. */
      currentOwner: (c) => currentAccount(c),
      ownsConversation: (userId, conversationId) =>
        store.conversations.get(conversationId)?.userId === userId,
      passages: biblePassages,
    }),
  );

  /*
   * Public profiles, mounted the same way and for the same reasons.
   *
   * The module owns its tables, its migration and — the part that matters —
   * the query that decides what a stranger may see. Keeping that query inside
   * `profile/store.ts` is what makes "authorisation before retrieval" checkable
   * in one place instead of spread across a route, a mapper and a component.
   */
  const profiles = createProfileStore(store);

  /*
   * Made once, not per route. Deleting a reflection has to reach it too — its
   * shares are copies of that reflection and must not survive it — and two
   * stores over one database would be two migrations racing on first use.
   */
  const communityStore = createCommunityStore(store);

  app.route(
    '/api/profiles',
    createProfileRoutes({
      currentUser: (c) => registeredUser(c),
      profiles,
    }),
  );

  /*
   * Community, mounted the same way and for the same reasons.
   *
   * The module owns its tables, its migration and — the part that matters — the
   * single visibility predicate that decides which publications a request may
   * see. Everything it needs from this file arrives as a function, so it never
   * learns what a store is, and `reflection` is visibly read-only: publishing
   * copies a reflection into a publication and issues no write against the
   * author's private source material.
   *
   * It is handed `null` when the backing cannot carry membership, and answers
   * 503 rather than pretending. Membership that disappears on restart is not
   * membership.
   */
  app.route(
    '/api',
    createCommunityRoutes({
      currentUser: (c) => registeredUser(c),
      store: communityStore,
      reflection: (userId, conversationId) => {
        const conversation = store.conversations.get(conversationId);
        if (!conversation || !userOwnsConversation(userId, conversation.id)) return null;
        const stored = store.sections.get(conversationId);
        return {
          format: conversation.format,
          title: conversation.title,
          scriptureReference: conversation.scriptureReference,
          sections:
            conversation.format === CHAT_FORMATS.CONDENSED
              ? condensedFromStore(stored)
              : sectionsFromStore(stored),
        };
      },
      userIdByEmail: (email) => store.accounts.byEmail(email)?.id ?? null,
      ensureIdentity: (user) => ensureProfile(profiles, user),
    }),
  );

  /*
   * "Continue as guest", and the only place a guest account is ever made.
   *
   * Asked for explicitly, by somebody who was shown the choice and took it. It
   * is a POST because it creates a user, and it carries where the choice
   * happened -- which reflection, which page -- because that context cannot be
   * reconstructed afterwards and is worth having when deciding whether the
   * prompt is appearing in the right place.
   *
   * Idempotent for anybody who is already somebody: a guest who somehow asks
   * again gets the account they already have rather than a second one, and a
   * signed-in person gets themselves.
   */
  app.post('/api/auth/guest', async (c) => {
    const existing = await currentAccount(c);
    if (existing) return c.json(accountBody(existing));

    const body = await c.req.json<unknown>().catch(() => ({}));
    const context = readCreationContext({
      ...(body as Record<string, unknown>),
      creationMethod: CREATION_METHODS.GUEST_OPT_IN,
      deviceClass: deviceClassFromRequest(c),
    });
    const { user, installationId } = await createGuest(c, auth, context);
    /*
     * A session as well as the credential. The credential is what makes them
     * the same guest next month; the session is what makes them somebody for
     * the next thirty seconds, and neither substitutes for the other.
     */
    await beginSession(c, user, { installationId, persistent: true });
    return c.json(accountBody(user), 201);
  });

  app.post('/api/auth/register', async (c) => {
    /*
     * Registration can be paused. It is the door abuse comes through — nothing
     * outward can be reached without an account — and pausing it stops new
     * abuse without touching anybody who is already here or anybody writing
     * privately as a guest.
     */
    if (!isEnabled(CAPABILITIES.REGISTRATION)) {
      return c.json({ error: unavailableReason(CAPABILITIES.REGISTRATION) }, 503);
    }
    const body = await c.req.json<{ email?: string; password?: string }>();
    const email = body.email?.trim().toLowerCase() ?? '';
    const password = body.password ?? '';
    if (!email || password.length < 8) {
      return c.json({ error: 'Email and a password of at least 8 characters are required.' }, 400);
    }
    /*
     * A guest registering claims the account they already have.
     *
     * Same row, same id, so every reflection written before this moment is
     * still pointed at by the same identifier afterwards and not one of them
     * is rewritten. That is the invariant the whole design exists to keep:
     * registration is an upgrade, not a new account with a migration attached.
     */
    const recognised = await recognisedAccount(c, auth);
    const guest =
      recognised && recognised.user.accountType === ACCOUNT_TYPES.ANONYMOUS
        ? recognised.user
        : null;
    const user = await auth.register(email, password, guest?.id ?? null);
    if (!user) {
      /*
       * The one case an upgrade cannot handle: this email is somebody's
       * account already. It is not overwritten and no content is moved --
       * they are told, and signing in to that account is what merges their
       * guest work into it.
       */
      return c.json(
        {
          error: 'An account with that email already exists.',
          accountExists: true,
          ...(guest ? { guestReflections: reflectionsOwnedBy(guest.id) } : {}),
        },
        409,
      );
    }
    /*
     * The installation stays exactly where it was.
     *
     * It is the same account -- upgraded, not replaced -- so the browser that
     * was recognised as this guest is now recognised as this registered user,
     * which is what "same user_id, same creations" means at the cookie level.
     * Somebody registering from a browser that was not recognised at all gets
     * durable recognition here, because they chose an account on this device.
     */
    const installationId =
      recognised?.installationId ??
      (await rememberInstallation(c, auth, user.id, PERSISTENCE_TYPES.REGISTERED_PERSISTENT));
    await beginSession(c, user, { installationId, persistent: true });
    return c.json(accountBody(user), 201);
  });

  app.post('/api/auth/login', async (c) => {
    const body = await c.req.json<{ email?: string; password?: string; keepSignedIn?: boolean }>();
    const email = body.email?.trim().toLowerCase() ?? '';
    const user = await auth.verify(email, body.password ?? '');
    if (!user) {
      return c.json({ error: 'Invalid email or password.' }, 401);
    }
    /*
     * The merge path, and the only one that moves anything.
     *
     * A guest whose email turns out to belong to an account cannot be upgraded
     * in place — that account exists and is not to be overwritten — so their
     * work moves into it, in a transaction, once they have proved the account
     * is theirs by signing in. Somebody who wrote three reflections and then
     * remembered they had an account sees all of them, not one set or the
     * other.
     *
     * The guest row is kept and marked rather than deleted, and its credential
     * is revoked, so a cookie left behind resolves to something known instead
     * of looking like a new visitor.
     */
    const recognised = await recognisedAccount(c, auth);
    const guest =
      recognised && recognised.user.accountType === ACCOUNT_TYPES.ANONYMOUS
        ? recognised.user
        : null;
    let merged = 0;
    if (guest && guest.id !== user.id) {
      merged = store.accounts.merge(guest.id, user.id);
      await auth.merge(guest.id, user.id);
      clearInstallationCookie(c);
    }

    /*
     * "Keep me signed in on this device", and nothing else, decides whether
     * this browser is durably recognised afterwards.
     *
     * Unticked leaves no durable credential at all -- not a short-lived one --
     * which is the right answer on a public computer. Whether a computer is
     * public is not guessed at: the person knows, and the checkbox is how they
     * say so.
     */
    const keepSignedIn = body.keepSignedIn === true;
    const installationId = keepSignedIn
      ? await rememberInstallation(c, auth, user.id, PERSISTENCE_TYPES.REGISTERED_PERSISTENT)
      : null;
    await beginSession(c, user, { installationId, persistent: keepSignedIn });
    return c.json({ ...accountBody(user), ...(merged > 0 ? { merged } : {}) });
  });

  /*
   * Ending the interaction, not the account.
   *
   * A registered user who asked to be kept signed in has that credential
   * revoked too, so the account does not simply restore itself on the next
   * request -- signing out has to mean something.
   *
   * A guest's installation credential is deliberately left alone. It is the
   * only way back to everything they have written, and destroying it behind an
   * ordinary "sign out" is exactly the accident this split exists to prevent.
   * Forgetting a guest is its own route, below, with its own warning.
   */
  app.post('/api/auth/logout', async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    const session = token ? await auth.sessionForToken(token) : null;
    if (token) await auth.endSession(token);
    if (session?.installationId && session.sessionType === SESSION_TYPES.REGISTERED_PERSISTENT) {
      await auth.revokeInstallation(session.installationId);
      clearInstallationCookie(c);
    }
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  /*
   * "Forget this guest on this browser": the destructive one.
   *
   * For an unregistered guest this is the end of their access to everything
   * they wrote -- there is no email to recover from and no second credential.
   * That is said plainly in the interface, and it is a separate action from
   * signing out precisely so it can be.
   */
  app.post('/api/auth/forget-installation', async (c) => {
    const recognised = await recognisedAccount(c, auth);
    if (recognised) await auth.revokeInstallation(recognised.installationId);
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await auth.endSession(token);
    clearInstallationCookie(c);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  /*
   * Who the client is talking to, guest included.
   *
   * A guest is a real answer here rather than a 401, because the interface has
   * something true to say about them — their name, and that their work is kept
   * on this device. A visitor is still a 401: there is genuinely nobody, and
   * asking who you are must not be what brings an account into existence.
   */
  app.get('/api/auth/me', async (c) => {
    const account = await currentAccount(c);
    if (!account) {
      return c.json({ error: 'Unauthenticated.' }, 401);
    }
    return c.json(accountBody(account));
  });

  app.post('/api/conversations', async (c) => {
    /*
     * Somebody has to own this, and nobody is created here to do it.
     *
     * A reflection is the first thing that must persist, so it is where the
     * choice belongs: a visitor is told an account is needed and shown the two
     * ways to have one. The client then asks for a guest, or signs in, and
     * tries again. Creating the guest here instead would be quicker and would
     * make "no account is created for a visitor" untrue.
     */
    const owner = await currentAccount(c);
    if (!owner) return c.json(accountRequired(CREATION_SOURCES.REFLECTION_CREATE), 401);
    /*
     * A title is not required to begin. Someone with a passage on their mind
     * should be able to start writing, not fill in a form first — so an untitled
     * conversation is created with a temporary name derived from whatever it is
     * about, and renamed later.
     */
    const body = await c.req
      .json<{ title?: string; scriptureReference?: string; format?: ChatFormat }>()
      .catch(() => ({}) as { title?: string; scriptureReference?: string; format?: ChatFormat });
    const timestamp = nowIso();
    const reference = body.scriptureReference?.trim() || null;
    const format: ChatFormat =
      body.format === CHAT_FORMATS.CONDENSED ? CHAT_FORMATS.CONDENSED : CHAT_FORMATS.FULL;
    const conversation: StoredConversation = {
      id: randomUUID(),
      userId: owner.id,
      format,
      title: body.title?.trim() || reference || 'New reflection',
      scriptureReference: reference,
      visibility: VISIBILITY.PRIVATE,
      tags: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    store.conversations.set(conversation.id, conversation);
    return c.json(summaryOf(conversation), 201);
  });

  app.get('/api/conversations', async (c) => {
    /*
     * Somebody's own list, whoever they are. An anonymous visitor with no
     * cookie yet has written nothing, so the honest answer is an empty list
     * rather than a refusal.
     */
    const owner = await currentAccount(c);
    if (!owner) return c.json([]);
    const items = [...store.conversations.values()]
      .filter((conversation) => conversation.userId === owner.id)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(summaryOf);
    return c.json(items);
  });

  /*
   * The reflection this request is allowed to touch.
   *
   * Ownership is the question, not authentication. Somebody who has never
   * signed in owns what they wrote, and the cookie naming their owner is
   * checked here against the database rather than believed — an identifier is
   * not an assertion.
   *
   * Not being able to reach a reflection is a 404 whether it does not exist or
   * belongs to somebody else, because "this is not yours" and "this is not
   * here" must not be distinguishable from outside.
   */
  /*
   * Whether an account owns a reflection.
   *
   * One comparison, because a guest's id and a registered user's id are the
   * same kind of thing. This is what the guest-as-user design buys: ownership
   * has one meaning everywhere instead of being routed through a second table
   * depending on who is asking.
   */
  const userOwnsConversation = (userId: string, conversationId: string) =>
    store.conversations.get(conversationId)?.userId === userId;

  const ownedConversation = async (c: Parameters<typeof currentUser>[0], id: string) => {
    const owner = await currentAccount(c);
    const conversation = store.conversations.get(id);
    if (!owner || !conversation || conversation.userId !== owner.id) {
      return { error: 404 as const, user: owner, owner, conversation: null };
    }
    return { error: null, user: owner, owner, conversation };
  };

  app.route('/api/studio-assets', createStudioImageRoutes({
    ...(studioImages.provider ? { provider: studioImages.provider } : {}),
    assets: studioImageAssets,
    currentUser: (c) => currentUser(c),
    ownsConversation: (userId, conversationId) => userOwnsConversation(userId, conversationId),
    now: nowIso,
  }));

  app.get('/api/conversations/:id', async (c) => {
    const { conversation } = await ownedConversation(c, c.req.param('id'));
    if (!conversation) {
      return c.json({ error: 'Conversation not found.' }, 404);
    }
    const stored = store.sections.get(conversation.id);
    return c.json({
      ...summaryOf(conversation),
      messages: store.messages.get(conversation.id) ?? [],
      sections: sectionsFromStore(stored),
      /*
       * Both drafts travel together. The page shows the one the format calls
       * for, and the other is still there to come back to.
       */
      condensed: condensedFromStore(stored),
    });
  });

  /**
   * Rename, re-reference, and change format.
   *
   * None of these are settings made once at creation: a reflection is named
   * after it is understood, the passage is often pinned down later, and the
   * format is a choice the author may revise. Nothing here deletes content —
   * changing format leaves both drafts in place.
   */
  app.patch('/api/conversations/:id', async (c) => {
    const { conversation } = await ownedConversation(c, c.req.param('id'));
    if (!conversation) {
      return c.json({ error: 'Conversation not found.' }, 404);
    }
    const body = await c.req
      .json<{ title?: string; scriptureReference?: string | null; format?: ChatFormat; tags?: unknown }>()
      .catch(() => ({}) as { title?: string; scriptureReference?: string | null; format?: ChatFormat; tags?: unknown });

    if (body.format !== undefined && !Object.values(CHAT_FORMATS).includes(body.format)) {
      return c.json({ error: 'Unknown format.' }, 400);
    }
    const format = body.format ?? conversation.format;

    /*
     * Length is checked against the format being moved to, not the one being
     * left, and it is refused rather than trimmed — the app never silently
     * shortens what someone wrote.
     */
    const limits = FORMAT_LIMITS[format].fields;
    const proposedTitle = body.title !== undefined ? body.title.trim() : conversation.title;
    const proposedReference =
      body.scriptureReference !== undefined
        ? (body.scriptureReference ?? '').trim() || null
        : conversation.scriptureReference;

    for (const [field, value] of [
      ['title', proposedTitle],
      ['scriptureReference', proposedReference ?? ''],
    ] as const) {
      const limit = limits[field];
      if (limit && value.length > limit.hard) {
        return c.json(
          {
            error: `The ${field === 'title' ? 'title' : 'Scripture reference'} is ${value.length - limit.hard} characters over its maximum.`,
            validation: {
              field,
              length: value.length,
              recommended: limit.recommended,
              hard: limit.hard,
            },
          },
          422,
        );
      }
    }

    if (body.title !== undefined && !proposedTitle) {
      return c.json({ error: 'A title cannot be empty.' }, 400);
    }

    conversation.title = proposedTitle;
    conversation.scriptureReference = proposedReference;
    conversation.format = format;
    if (body.tags !== undefined) {
      conversation.tags = readStoredTags(body.tags);
    } else {
      conversation.tags = conversation.tags ?? [];
    }
    conversation.updatedAt = nowIso();
    store.conversations.set(conversation.id, conversation);
    return c.json(summaryOf(conversation));
  });

  /**
   * Delete a reflection, and everything that is part of it.
   *
   * The messages and the sections are the reflection, not satellites of it, so
   * they go too. Confirmation is the interface's job; by the time a request
   * arrives here the author has said yes.
   *
   * And so do its shares. A publication is a copy taken at the moment of
   * sharing — that is what lets a community show a reflection without reaching
   * into somebody's private writing — and the price of that copy is that it
   * must not outlive the thing it was taken from. Without this, deleting a
   * reflection left the copies standing: a community keeping something whose
   * author had destroyed it and could no longer reach it.
   */
  app.delete('/api/conversations/:id', async (c) => {
    const { conversation, owner } = await ownedConversation(c, c.req.param('id'));
    if (!conversation || !owner) {
      return c.json({ error: 'Conversation not found.' }, 404);
    }
    const shares = communityStore?.removeSharesOfConversation(conversation.id, owner.id) ?? 0;
    store.sections.delete(conversation.id);
    store.messages.delete(conversation.id);
    store.conversations.delete(conversation.id);
    return c.json({ id: conversation.id, deleted: true, sharesRemoved: shares });
  });

  app.post('/api/conversations/:id/messages', async (c) => {
    const { conversation } = await ownedConversation(c, c.req.param('id'));
    if (!conversation) {
      return c.json({ error: 'Conversation not found.' }, 404);
    }
    const body = await c.req.json<{ content?: string }>();
    const content = body.content?.trim() ?? '';
    if (!content) {
      return c.json({ error: 'Message content is required.' }, 400);
    }
    const message = {
      id: randomUUID(),
      conversationId: conversation.id,
      role: 'user' as const,
      content,
      originalContent: content,
      authorOrigin: 'user' as const,
      createdAt: nowIso(),
    };
    store.messages.append(conversation.id, message);
    conversation.updatedAt = message.createdAt;
    store.conversations.set(conversation.id, conversation);
    return c.json(message, 201);
  });

  /*
   * Sharing a reflection inside C.H.A.T.
   *
   * Was `/publish`. The path changed with the idea: nothing is published, a
   * reflection is shared, and it is shared because somebody asked for it here
   * — never because they finished writing or pressed Save.
   */
  app.post('/api/conversations/:id/share', async (c) => {
    const { conversation } = await ownedConversation(c, c.req.param('id'));
    if (!conversation) {
      return c.json({ error: 'Conversation not found.' }, 404);
    }
    /*
     * The format rules are enforced here rather than only in the editor. A
     * client is a convenience; this is the boundary that decides whether an
     * incomplete or over-long reflection can become a publication, and it
     * answers with the structured report so the interface can say exactly which
     * field is at fault and by how much.
     */
    const validation = validateChat(conversation.format, draftOf(conversation), {
      extensionAcknowledged: c.req.query('acknowledgeExtension') === 'true',
    });

    if (!validation.shareable) {
      return c.json({ error: 'This reflection is not ready to share.', validation }, 422);
    }

    conversation.visibility = VISIBILITY.SHARED;
    conversation.updatedAt = nowIso();
    store.conversations.set(conversation.id, conversation);
    return c.json(summaryOf(conversation));
  });

  /* Taking it back. Was `/unpublish`; nothing was ever published. */
  app.post('/api/conversations/:id/make-private', async (c) => {
    const { conversation } = await ownedConversation(c, c.req.param('id'));
    if (!conversation) {
      return c.json({ error: 'Conversation not found.' }, 404);
    }
    conversation.visibility = VISIBILITY.PRIVATE;
    conversation.updatedAt = nowIso();
    store.conversations.set(conversation.id, conversation);
    return c.json(summaryOf(conversation));
  });

  app.patch('/api/conversations/:id/sections', async (c) => {
    const { conversation } = await ownedConversation(c, c.req.param('id'));
    if (!conversation) {
      return c.json({ error: 'Conversation not found.' }, 404);
    }
    const body = await c.req.json<{
      type?: SectionType;
      content?: string;
      authorOrigin?: AuthorOrigin;
    }>();
    if (!body.type || !SECTION_TYPES.includes(body.type)) {
      return c.json({ error: 'A known section type is required.' }, 400);
    }

    const content = body.content ?? '';
    const limit = FORMAT_LIMITS[conversation.format].fields[body.type];
    if (limit && content.length > limit.hard) {
      return c.json(
        {
          error: `${body.type} is ${content.length - limit.hard} characters over its maximum of ${limit.hard}.`,
          validation: {
            field: body.type,
            length: content.length,
            recommended: limit.recommended,
            hard: limit.hard,
          },
        },
        422,
      );
    }

    /*
     * Provenance is stated by the caller, and defaults to the author.
     *
     * When someone accepts an AI suggestion into a section, the interface says
     * so here and the badge on the card keeps saying so. Silently re-labelling
     * assisted wording as the author's own would be a lie the data model is
     * perfectly capable of avoiding.
     */
    const authorOrigin: AuthorOrigin =
      body.authorOrigin && AUTHOR_ORIGIN_VALUES.includes(body.authorOrigin)
        ? body.authorOrigin
        : AUTHOR_ORIGINS.USER;

    /*
     * One field is written, and only that field. The record handed to the store
     * used to be a whole rebuilt set, which is how an empty value for a section
     * nobody touched could reach the database.
     */
    store.sections.set(conversation.id, {
      [body.type]: { type: body.type, content, authorOrigin },
    });
    conversation.updatedAt = nowIso();
    store.conversations.set(conversation.id, conversation);

    const stored = store.sections.get(conversation.id);
    return c.json({
      sections: sectionsFromStore(stored),
      condensed: condensedFromStore(stored),
    });
  });

  app.post('/api/conversations/:id/ai', async (c) => {
    const { user, conversation } = await ownedConversation(c, c.req.param('id'));
    if (!conversation) {
      return c.json({ error: 'Conversation not found.' }, 404);
    }
    const body = await c.req.json<{ action?: AiAction; messageId?: string }>();
    const action = body.action;
    if (!action || !Object.values(AI_ACTIONS).includes(action)) {
      return c.json({ error: 'A named AI action is required.' }, 400);
    }

    /*
     * Unavailable is an answer, not a silence. A control that cannot work says
     * why, here and in the interface, rather than appearing to do nothing.
     */
    const status = aiStatus();
    if (!status.enabled) {
      return c.json({ error: status.reason ?? 'Assistance is unavailable.', ai: status }, 503);
    }

    const messages = store.messages.get(conversation.id) ?? [];

    if (action === AI_ACTIONS.SUGGEST_TITLE) {
      /*
       * Suggesting a name for the work, from the work.
       *
       * The model is asked first and the heuristic is the FLOOR, not the
       * ceiling. That ordering is the whole design: the heuristic rearranges
       * the author's own opening clause, which reliably produces a sentence
       * someone interrupted — "Romans 8:28 met me this week and I could not" —
       * where a title should name the tension, the turn or the claim. But the
       * heuristic needs no key and no network, so when the model is off,
       * unconfigured, rate-limited or simply failing, the button keeps working
       * instead of going dark.
       *
       * The sheet says which produced the candidates, because an author should
       * never be misled about where a suggestion came from.
       *
       * Nothing here writes anything. Candidates are strings; the title changes
       * only when the author picks one and PATCHes it themselves.
       */
      const limits = FORMAT_LIMITS[conversation.format].fields['title'];
      const maxChars = limits?.hard ?? 100;
      const recommendedChars = limits?.recommended ?? 60;

      let suggestions: string[] = [];
      let source: string = TITLE_SOURCES.HEURISTIC;

      if (aiService.modelStatus().available) {
        const stored = sectionsFromStore(store.sections.get(conversation.id));
        const sections: Record<string, string> = {};
        for (const [type, section] of Object.entries(stored)) {
          if (section.content.trim()) sections[type] = section.content;
        }

        const result = await aiService.suggestTitles(
          {
            passageReference: conversation.scriptureReference ?? '',
            sections,
            history: messages.map((message) => ({
              role: message.role,
              content: message.content,
            })),
            maxChars,
            recommendedChars,
          },
          {
            userId: user?.id ?? 'unknown',
            address: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
            requestId: randomUUID(),
          },
        );

        if (result.ok && result.value.titles.length > 0) {
          suggestions = result.value.titles;
          source = TITLE_SOURCES.MODEL;
        }
      }

      if (suggestions.length === 0) {
        /* The floor. Always available, and honest about being the floor. */
        suggestions = suggestTitles(conversation.format, {
          scriptureReference: conversation.scriptureReference,
          messages,
          sections: store.sections.get(conversation.id),
        });
        source = TITLE_SOURCES.HEURISTIC;
      }

      if (suggestions.length === 0) {
        return c.json(
          {
            error:
              'There is not enough written yet to suggest a title. Write a little first.',
          },
          422,
        );
      }

      /*
       * Checked once more on the way out, whatever produced them. A candidate
       * that arrives already over the field's maximum would report invalid the
       * moment it landed, which is a bug rather than a suggestion.
       */
      const withinLimit = suggestions.filter((title) => title.length <= maxChars);

      return c.json({
        action,
        applied: false,
        suggestions: withinLimit.length > 0 ? withinLimit : suggestions.slice(0, 1),
        currentTitle: conversation.title,
        origin: AUTHOR_ORIGINS.AI_GENERATED,
        provider: status.provider,
        /* Which side wrote these. Shown in the sheet. */
        source,
      });
    }

    if (action === AI_ACTIONS.EXTRACT_CHAT) {
      /*
       * Extraction proposes. It does not write.
       *
       * This route used to store its result over the whole section record, so
       * pressing "Extract from conversation" deleted every section the author
       * had written by hand — the worst possible reading of a rule that already
       * forbade the model inventing Heart, Application or Testimony. Deleting
       * them is worse than inventing them.
       *
       * Now the proposal comes back, the author reviews it section by section,
       * and accepting one is an ordinary section write carrying `ai_assisted`.
       */
      const derived = extractChatSections(messages);
      const existing = sectionsFromStore(store.sections.get(conversation.id));

      /* Nothing the author wrote is offered up for replacement silently. */
      const proposed = Object.fromEntries(
        Object.entries(derived).filter(([type, section]) => {
          const current = existing[type as keyof typeof existing];
          return section.content.trim() !== '' && section.content !== current.content;
        }),
      );

      return c.json({
        action,
        applied: false,
        /* `sections` stays the stored truth; `proposed` is what is on offer. */
        sections: existing,
        proposed,
        conflicts: Object.keys(proposed).filter(
          (type) =>
            existing[type as keyof typeof existing].content.trim() !== '' &&
            existing[type as keyof typeof existing].authorOrigin === AUTHOR_ORIGINS.USER,
        ),
      });
    }

    const target =
      messages.find((message) => message.id === body.messageId) ??
      [...messages].reverse().find((message) => message.role === 'user');
    if (!target) {
      return c.json({ error: 'No user message is available for this action.' }, 400);
    }

    const result = applyNamedAiAction(action, target.content);
    if (action === AI_ACTIONS.EXPLAIN) {
      const assistantMessage = {
        id: randomUUID(),
        conversationId: conversation.id,
        role: 'assistant' as const,
        content: result.revised,
        originalContent: result.revised,
        authorOrigin: result.origin,
        createdAt: nowIso(),
      };
      store.messages.append(conversation.id, assistantMessage);
      conversation.updatedAt = assistantMessage.createdAt;
      store.conversations.set(conversation.id, conversation);
      return c.json({
        action,
        original: target.content,
        revised: result.revised,
        /* Said out loud, so the badge on the card can keep saying it. */
        origin: result.origin,
        replaced: false,
        message: assistantMessage,
      });
    }

    return c.json({
      action,
      original: target.originalContent,
      revised: result.revised,
      origin: result.origin,
      replaced: false,
      messageId: target.id,
    });
  });

  /*
   * Reflections — the user's own work, searched and filtered.
   *
   * Kept at /api/library as well, because the web app has not been renamed yet
   * and a rename that breaks the running client for one commit is a rename done
   * badly. The old path is an alias and goes when the page moves.
   */
  const reflections = async (c: Context) => {
    const owner = await currentAccount(c);
    const parsed = readReflectionFilters({
      get: (name) => c.req.query(name),
    });
    if ('error' in parsed) {
      return c.json({ error: parsed.error }, 400);
    }

    const mine = owner
      ? [...store.conversations.values()].filter(
          (conversation) => conversation.userId === owner.id,
        )
      : [];

    const items = mine.filter((conversation) => {
      /*
       * "Complete" means the format's own rules are satisfied — the same
       * validator that gates sharing — rather than a flag someone remembered
       * to set.
       */
      if (parsed.status !== 'all') {
        const complete =
          validateChat(conversation.format, draftOf(conversation)).missing.length === 0;
        if (parsed.status === 'draft' && complete) return false;
        if (parsed.status === 'complete' && !complete) return false;
      }

      /* Shared means it has been given an audience. Everything else is yours. */
      if (parsed.visibility !== 'all') {
        const shared = conversation.visibility === VISIBILITY.SHARED;
        if (parsed.visibility === 'shared' && !shared) return false;
        if (parsed.visibility === 'private' && shared) return false;
      }

      return matchesReflection(
        conversation,
        store.sections.get(conversation.id),
        store.messages.get(conversation.id) ?? [],
        parsed,
      );
    });

    items.sort((a, b) =>
      parsed.sort === 'title'
        ? a.title.localeCompare(b.title)
        : b.updatedAt.localeCompare(a.updatedAt),
    );

    /*
     * The page is cut here rather than in the browser.
     *
     * `total` is the whole matching set, so the collection can say how many
     * there are and how many pages without having been sent them — which is
     * the point: a library of a thousand reflections must not put a thousand
     * rows on the wire to show twenty.
     *
     * A page number past the end returns the last page rather than nothing,
     * because that is what a stale link or a narrowed filter produces, and an
     * empty screen reads as "you have no reflections".
     */
    const pageCount = Math.max(1, Math.ceil(items.length / parsed.pageSize));
    const page = Math.min(parsed.page, pageCount);
    const start = (page - 1) * parsed.pageSize;

    return c.json({
      items: items.slice(start, start + parsed.pageSize).map(summaryOf),
      total: items.length,
      page,
      pageSize: parsed.pageSize,
      pageCount,
      tags: tagFacets(mine),
      books: bookFacets(mine),
    });
  };

  app.get('/api/reflections', reflections);
  app.get('/api/library', reflections);

  app.get('/api/community', async (c) => {
    const user = await requireUser(c);
    if (!user) {
      return c.json({ error: 'Unauthenticated.' }, 401);
    }
    const items = [...store.conversations.values()]
      .filter((conversation) => conversation.visibility === VISIBILITY.SHARED)
      .map(summaryOf);
    return c.json(items);
  });

  /*
   * Create Studio remains a controlled component. These endpoints persist its
   * canonical document and release metadata; they never render, interpret a
   * reflection, or expose another user's creation.
   */
  app.get('/api/studio-creations/:conversationId', async (c) => {
    const { conversation } = await ownedConversation(c, c.req.param('conversationId'));
    if (!conversation) return c.json({ error: 'Conversation not found.' }, 404);
    return c.json({ creation: studioCreations.get(conversation.id) });
  });

  app.put('/api/studio-creations/:conversationId', async (c) => {
    const { conversation } = await ownedConversation(c, c.req.param('conversationId'));
    if (!conversation) return c.json({ error: 'Conversation not found.' }, 404);
    const previous = studioCreations.get(conversation.id);
    const creation = readStudioCreation(
      await c.req.json().catch(() => null),
      conversation.id,
      previous,
      nowIso(),
    );
    if (!creation) {
      return c.json(
        { error: 'The Studio document or its persistence metadata is invalid.' },
        400,
      );
    }
    studioCreations.set(creation);
    return c.json({ creation });
  });

  app.post('/api/creations', async (c) => {
    const user = await requireUser(c);
    if (!user) {
      return c.json({ error: 'Unauthenticated.' }, 401);
    }
    const body = await c.req.json<{
      conversationId?: string;
      layout?: CreateLayout;
      style?: CreateStyle;
    }>();
    if (!body.conversationId) {
      return c.json({ error: 'conversationId is required.' }, 400);
    }
    const { conversation } = await ownedConversation(c, body.conversationId);
    if (!conversation) {
      return c.json({ error: 'Conversation not found.' }, 404);
    }
    const layout = body.layout ?? CREATE_LAYOUTS.QUOTE_FOCUS;
    const style = body.style ?? CREATE_STYLES.CREAM_BOTANICAL;
    const sections = sectionsFromStore(store.sections.get(conversation.id));
    return c.json({
      conversationId: conversation.id,
      title: conversation.title,
      scriptureReference: conversation.scriptureReference,
      layout,
      style,
      sections,
      textRenderedBy: 'application',
    });
  });

  return app;
}

export const app = createApp();
