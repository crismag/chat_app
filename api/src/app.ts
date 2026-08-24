import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { sessionCookieOptions } from './auth/session-cookie.ts';
import { SqliteAuthStore, type AuthStore, type AuthUser } from './auth/store.ts';
import {
  GoogleTokenError,
  createGoogleVerifier,
  readGoogleClientId,
  type GoogleVerifier,
} from './auth/google.ts';
import { dropUserForeignKeys } from './db.ts';
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
import { SlidingWindowRateLimiter, type RateLimitDecision } from './ai/rate-limit.ts';
import { addressOf } from './http/address.ts';
import { createMailer, type Mailer } from './mail/mailer.ts';
import {
  PASSWORD_MIN,
  RESET_REQUESTED_MESSAGE,
  resetEmail,
  resetUrl,
} from './auth/password-reset.ts';
import { CAPABILITIES, isEnabled, unavailableReason } from './http/capabilities.ts';
import { hashPassword, verifyPassword } from './auth/local-password.ts';
import { publicWebOrigin, webOrigins } from './http/origins.ts';
import {
  AUTHOR_ORIGINS,
  CHAT_FORMATS,
  CHAT_SECTION_TYPES,
  CONDENSED_SECTION_TYPES,
  previewFor,
  FORMAT_LIMITS,
  validateChat,
  type AuthorOrigin,
  type ChatFormat,
  AI_ACTIONS,
  VISIBILITY,
  TITLE_SOURCES,
  type AiAction,
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
import { createNotesRoutes } from './notes/routes.ts';
import { createNotesStore } from './notes/store.ts';
import { createLibraryRoutes } from './library/routes.ts';
import { createMessagingRoutes } from './messaging/routes.ts';
import { createMessagingStore } from './messaging/store.ts';
import { createStudioCreationStore } from './create/store.ts';
import { readStudioCreation } from './create/validation.ts';
import { createStudioImageRoutes } from './create/image-routes.ts';
import { createStudioImageAssetStore } from './create/image-store.ts';
import type { StudioImageProvider } from './create/image-provider.ts';
import {
  EMPTY_LISTS,
  type DomainListSnapshot,
  classifyDomain,
  loadDomainLists,
} from './auth/email-domains.ts';
import {
  VERIFICATION_SENT_MESSAGE,
  VERIFICATION_SPENT_MESSAGE,
  VERIFICATION_TTL_MS,
  hashVerificationToken,
  newVerificationToken,
  verificationEmail,
  verificationUrl,
} from './auth/email-verification.ts';
import { MailDomainCheck, type MailDomainResolver } from './auth/mail-domain.ts';
import { SqliteStore } from './db.ts';
import { onError } from './http/errors.ts';
import { requestId } from './http/request-id.ts';
import { hashSessionToken } from './mysql/tokens.ts';
import { MemoryStore, type StoredConversation } from './store.ts';
import { BOOKS } from './bible/books.ts';
import { matchesReflection, readReflectionFilters } from './reflections/query.ts';
import { parseScriptureQuery } from './reflections/scripture-query.ts';
import { createTagRegistry } from './tags/store.ts';
import { createTagRoutes } from './tags/routes.ts';
import { rawTagStrings, refusalMessage, validateTags } from './tags/validate.ts';

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
  /* Injected in tests so a reset can be read without an SMTP server. */
  /*
   * `googleVerifier` is injectable so the suite never depends on Google being
   * reachable, and so the failures that matter — a token for another audience,
   * an expired one, one identifying nobody — can be exercised without minting
   * real tokens.
   */
  options: {
    mailer?: Mailer;
    /** Injected so the suite never performs a DNS lookup. */
    mailDomainResolver?: MailDomainResolver;
    googleVerifier?: GoogleVerifier;
    loginEmailLimiter?: SlidingWindowRateLimiter;
    loginAddressLimiter?: SlidingWindowRateLimiter;
    registerLimiter?: SlidingWindowRateLimiter;
    guestLimiter?: SlidingWindowRateLimiter;
  } = {},
) {
  const googleClientId = readGoogleClientId();
  /*
   * Absent configuration is not an error at startup: a checkout without a
   * Google client id runs, and the route says plainly that it is not
   * configured rather than failing in a way that looks like a bug.
   */
  const googleVerifier: GoogleVerifier | null =
    options.googleVerifier ?? (googleClientId ? createGoogleVerifier(googleClientId) : null);
  /* Ten attempts a minute from one address is generous for a person and mean for a script. */
  const googleAttempts = new SlidingWindowRateLimiter(10);
  const loginEmailAttempts = options.loginEmailLimiter ?? new SlidingWindowRateLimiter(10);
  const loginAddressAttempts = options.loginAddressLimiter ?? new SlidingWindowRateLimiter(40);
  const registerAttempts = options.registerLimiter ?? new SlidingWindowRateLimiter(10);
  const guestAttempts = options.guestLimiter ?? new SlidingWindowRateLimiter(10);

  const app = new Hono();
  const aiService = new AiService(ai);
  /* One allowance for the life of the process, like the other rate limiters. */
  const anonymousAllowance = new AnonymousAiAllowance();

  /*
   * Whoever is asking, not whose address it is. Five an hour from one place is
   * plenty for somebody who has genuinely lost a password, and few enough that
   * this route cannot be used to post mail at somebody.
   */
  const resetLimiter = new SlidingWindowRateLimiter(5, Date.now, 60 * 60 * 1000);
  /* Same reasoning as the reset limiter: this route also puts mail in the world. */
  const verificationLimiter = new SlidingWindowRateLimiter(5, Date.now, 60 * 60 * 1000);
  const mailer = options.mailer ?? createMailer();

  /*
   * Whether a domain can receive mail at all.
   *
   * A resolver is injected in tests, which is what keeps the suite off the
   * network: nothing here performs a lookup unless a real one is configured.
   * Without one this answers "unavailable" for everything, which means nothing
   * is ever refused for it — the safe direction.
   */
  /*
   * The domain lists, read once on first use and then held.
   *
   * Membership is asked on every registration, so it is a hash lookup against
   * memory rather than a scan of a file with tens of thousands of lines in it.
   * Nothing here reaches the network: the registry is a local cache that a
   * separate updater refreshes, because signing up has to keep working when
   * GitHub does not.
   *
   * Unset means no lists, which means every domain is unknown and nothing is
   * refused for it. A deployment that has not configured this is not thereby
   * turning people away.
   */
  const listDirectory = process.env['EMAIL_DOMAIN_LIST_DIR']?.trim();
  let loadedLists: Promise<DomainListSnapshot> | null = null;
  const domainLists = () => {
    loadedLists ??= listDirectory
      ? loadDomainLists(listDirectory).catch(() => EMPTY_LISTS)
      : Promise.resolve(EMPTY_LISTS);
    return loadedLists;
  };

  const mailDomains = new MailDomainCheck(
    options.mailDomainResolver ?? {
      resolveMx: () => Promise.reject(new Error('EAI_AGAIN')),
      resolveAddress: () => Promise.reject(new Error('EAI_AGAIN')),
    },
  );

  const refused = (c: Context, decision: RateLimitDecision, message: string) => {
    c.header('Retry-After', String(decision.retryAfterSeconds));
    return c.json({ error: message }, 429);
  };
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

  /*
   * Before anything else, so a request that fails inside CORS or auth still
   * has an identifier to be reported by.
   */
  app.use('/api/*', requestId());

  app.onError(onError);

  app.use(
    '/api/*',
    cors({
      origin: webOrigins(),
      /*
       * PUT is here for the same reason PATCH and DELETE are: something in
       * the application sends one. Three routes do — the avatar upload, a
       * Bible passage save and a Studio creation save — and every one of them
       * is unreachable cross-origin without it. The browser's own preflight
       * is what enforces this list, not this server: a PUT missing from here
       * fails silently in the browser, before the request the API would have
       * happily served is ever sent. Reported to whoever clicked "Add a
       * picture" as "Load failed", which named the browser's fetch failure
       * and nothing about CORS.
       */
      allowMethods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
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
  /*
   * The account, plus the public identity that goes with it.
   *
   * Without this the header showed one face and the profile page another for
   * the same person: the account knows an email address, the profile knows a
   * name, and each was deriving its own initial from whichever it had. A
   * person should not appear to be two people while moving through one
   * application.
   *
   * Read rather than created. Asking for the account must not bring a profile
   * row into existence for somebody who has never opened one — a guest has no
   * public profile, and this is not the place to give them one.
   */
  const accountBody = (account: AuthUser) => {
    const profile = profiles.byUserId(account.id);
    return {
      id: account.id,
      accountType: account.accountType,
      email: account.email,
      guestName: account.guestName,
      emailVerified: account.emailVerified,
      /*
       * Public identity only: the name and handle a stranger would see
       * anyway. Nothing private is added to a payload that already travels
       * everywhere.
       */
      displayName: profile?.displayName ?? null,
      handle: profile?.handle ?? null,
      /*
       * The same URL the profile page uses, so the face in the account menu is
       * the face on the profile. Built here rather than shared with the
       * profile routes because it is one template; importing across features
       * to save a line would tie this file to that one.
       */
      avatarUrl:
        profile?.avatarUpdatedAt && profile.handle
          ? `/api/profiles/${encodeURIComponent(profile.handle)}/avatar?v=${encodeURIComponent(profile.avatarUpdatedAt)}`
          : null,
    };
  };

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
    return user?.accountType === ACCOUNT_TYPES.REGISTERED
      ? { id: user.id, email: user.email ?? '', createdAt: user.createdAt }
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
   * Whether this process can actually serve, as opposed to whether it is
   * running.
   *
   * `/api/health` answers the second question and keeps answering it: it is
   * what a process manager restarts on, and a restart because a database is
   * briefly busy makes an outage longer rather than shorter. So readiness is a
   * separate path, and existing clients see no change.
   *
   * It touches both stores, because this deployment has two: content in
   * SQLite, accounts in MariaDB when it is configured. A process that can
   * reach one and not the other cannot sign anybody in *or* show them their
   * writing, and reporting "ok" in that state is how a load balancer keeps
   * sending people to a server that cannot help them.
   */
  app.get('/api/health/ready', async (c) => {
    const checks: Record<string, 'ok' | 'unavailable'> = {};

    try {
      store.conversations.get('readiness-probe');
      checks['content'] = 'ok';
    } catch {
      checks['content'] = 'unavailable';
    }

    /*
     * Only when accounts actually live there. Reporting an unconfigured
     * MariaDB as unavailable would make every SQLite-only deployment look
     * broken.
     */
    if (auth.ready) {
      checks['accounts'] = (await auth.ready().then(
        () => 'ok' as const,
        () => 'unavailable' as const,
      ));
    }

    const ready = Object.values(checks).every((state) => state === 'ok');
    return c.json(
      { status: ready ? 'ready' : 'unavailable', service: 'chat-api', checks, timestamp: nowIso() },
      ready ? 200 : 503,
    );
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
  const notesStore = createNotesStore(store);

  /*
   * The tag registry. Constructed here, beside the other feature stores, and
   * written by the handlers that save tagged content rather than by an endpoint
   * of its own — a tag exists because something was tagged.
   */
  const tagRegistry = createTagRegistry(store);
  const messagingStore = createMessagingStore(store);

  /*
   * Now that every store has made its tables, remove the foreign keys that
   * point at a `users` table which no longer holds the people using this.
   * Accounts are in MariaDB; a constraint saying otherwise fails the first
   * write on behalf of a real account, which is what it was doing.
   */
  if ('db' in store) dropUserForeignKeys(store.db);

  app.route(
    '/api/profiles',
    createProfileRoutes({
      currentUser: (c) => registeredUser(c),
      /*
       * Anybody, including a guest and including nobody. Only the public
       * profile read uses this; everything that writes still requires a
       * registered account.
       */
      currentViewer: async (c) => {
        const user = await currentUser(c);
        return user ? { id: user.id } : null;
      },
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
      currentUser: async (c) => {
        const user = await currentUser(c);
        if (user?.accountType !== ACCOUNT_TYPES.REGISTERED) return null;
        return {
          id: user.id,
          email: user.email ?? '',
          createdAt: user.createdAt,
          /* Publishing asks; nothing else here does. */
          emailVerified: user.emailVerified,
        };
      },
      /*
       * Anybody with a session, guest included. A guest has no email, so they
       * are given one that is plainly not an address — the community store
       * keys on `id`, and `email` exists here only so the shape is one type.
       * Nothing sends to it and nothing displays it.
       */
      currentReader: async (c) => {
        const user = await currentUser(c);
        if (!user) return null;
        return { id: user.id, email: user.email ?? '', createdAt: user.createdAt };
      },
      store: communityStore,
      /* The registry, injected — the community module owns no tag storage. */
      tags: {
        validate: (raw) => validateTags(raw),
        record: (input) => tagRegistry.record(input),
      },
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
      userIdByEmail: async (email) => (await auth.findByEmail(email))?.id ?? null,
      userIdByHandle: (handle) => profiles.byHandle(handle)?.userId ?? null,
      ensureIdentity: (user) => ensureProfile(profiles, user),
    }),
  );

  /*
   * Private notes. Mounted the same way as profile and community: the module
   * owns its table and its queries, and the owner is whoever currentAccount
   * already is — session or recognised guest — never a client-supplied id.
   */
  /*
   * Tag suggestions. Read-only, and open to a visitor: somebody writing before
   * they have an account still deserves to be offered the word other people
   * already use, and the ranking's global fallback is exactly that case.
   */
  app.route(
    '/api/tags',
    createTagRoutes({
      currentOwner: (c) => currentAccount(c),
      registry: tagRegistry,
    }),
  );

  app.route(
    '/api/notes',
    createNotesRoutes({
      currentOwner: (c) => currentAccount(c),
      store: notesStore,
    }),
  );

  /*
   * A personal library file. Registered accounts only — this lives on the
   * profile, and a guest has no profile. Exporting is not sharing; importing
   * always creates new private copies.
   */
  app.route(
    '/api/library',
    createLibraryRoutes({
      currentUser: (c) => currentUser(c),
      conversations: store.conversations,
      sections: store.sections,
      passages: biblePassages,
      notes: notesStore,
      tags: {
        validate: (raw) => validateTags(raw),
        record: (input) => tagRegistry.record(input),
      },
    }),
  );

  /*
   * Private messaging between registered accounts. Guests are refused here —
   * a guest prompt would create an account that still could not use Messages.
   * Block is the existing profile block, not a second table.
   */
  app.route(
    '/api/messaging',
    createMessagingRoutes({
      /* Verification travels: sending asks for it, reading does not. */
      currentUser: async (c) => {
        const user = await currentUser(c);
        if (user?.accountType !== ACCOUNT_TYPES.REGISTERED) return null;
        return { id: user.id, emailVerified: user.emailVerified };
      },
      store: messagingStore,
      profiles,
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

    const guestLimited = guestAttempts.take(addressOf(c));
    if (!guestLimited.allowed) {
      return refused(c, guestLimited, 'Too many accounts from here. Try again shortly.');
    }

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
    const registerLimited = registerAttempts.take(addressOf(c));
    if (!registerLimited.allowed) {
      return refused(c, registerLimited, 'Too many accounts from here. Try again shortly.');
    }
    const body = await c.req.json<{ email?: string; password?: string }>();
    const email = body.email?.trim().toLowerCase() ?? '';
    const password = body.password ?? '';
    if (!email || password.length < 8) {
      return c.json({ error: 'Email and a password of at least 8 characters are required.' }, 400);
    }

    /*
     * A domain worth sending a link to.
     *
     * Deny-based, never a list of approved providers: a whitelist of the big
     * four turns away the pastor at a church domain, the student at a
     * university and everybody who runs their own — a large share of the
     * people this is for. The question is not "have we heard of this
     * provider", it is "will this mailbox still exist tomorrow".
     *
     * This may be specific about why, unlike the sign-in and reset replies. It
     * discloses nothing about who has an account, and telling somebody their
     * throwaway address was refused is the only way they can use a real one.
     * It does not say *which* list caught it, because that would tell somebody
     * probing exactly which one to try next.
     */
    const domain = email.slice(email.lastIndexOf('@') + 1);
    const verdict = classifyDomain(domain, await domainLists());
    if (verdict === 'disposable' || verdict === 'blocked') {
      return c.json(
        {
          error:
            'That email provider cannot be used here. Please use an address you will still have next month.',
        },
        400,
      );
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

    /*
     * The link goes out now, so confirming is something they do from the email
     * already in their inbox rather than a button they must go and find.
     *
     * Never fatal and never reported. The account was created; a mail server
     * refusing connections is not a reason to say otherwise, and another link
     * can be asked for at any time.
     */
    await sendVerificationLink(user).catch((error: unknown) =>
      console.warn('verification mail failed:', error),
    );

    return c.json(accountBody(user), 201);
  });

  app.post('/api/auth/login', async (c) => {
    const body = await c.req.json<{ email?: string; password?: string; keepSignedIn?: boolean }>();
    const email = body.email?.trim().toLowerCase() ?? '';
    const addressLimited = loginAddressAttempts.take(addressOf(c));
    if (!addressLimited.allowed) {
      return refused(c, addressLimited, 'Too many sign-in attempts. Try again shortly.');
    }
    if (email) {
      const emailLimited = loginEmailAttempts.take(email);
      if (!emailLimited.allowed) {
        return refused(c, emailLimited, 'Too many sign-in attempts. Try again shortly.');
      }
    }
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
   * Signing in with Google.
   *
   * Identity only. Google is asked one question — is this the person they say
   * they are — and once it has answered, Google is out of the picture: the
   * application's own session carries every request afterwards, and no access
   * token, refresh token or scope is requested, stored or wanted.
   *
   * Nothing the browser says about who it is, is believed. The credential is a
   * token signed by Google and is verified server-side against Google's
   * published keys and this application's client id; the subject inside it is
   * the only identifier used, and the address it carries is descriptive.
   */
  app.post('/api/auth/google', async (c) => {
    if (!googleVerifier) {
      return c.json({ error: 'Signing in with Google is not configured on this server.' }, 503);
    }

    /*
     * By address, because this route is reachable before anybody is anybody.
     * A ceiling here is what stops a stolen or forged credential being tried
     * repeatedly.
     */
    const decision = googleAttempts.take(addressOf(c));
    if (!decision.allowed) {
      c.header('Retry-After', String(decision.retryAfterSeconds));
      return c.json({ error: 'Too many sign-in attempts. Try again shortly.' }, 429);
    }

    const body = await c.req
      .json<{ credential?: unknown; keepSignedIn?: boolean }>()
      .catch(() => ({}) as { credential?: unknown; keepSignedIn?: boolean });
    const credential = typeof body.credential === 'string' ? body.credential : '';

    let identity;
    try {
      identity = await googleVerifier.verify(credential);
    } catch (error: unknown) {
      /*
       * The reason is logged and never returned. A verification message can
       * name key ids, audiences and clock skew; the browser gets one sentence,
       * and no part of the token is echoed back or written to the log.
       */
      const code = error instanceof GoogleTokenError ? error.code : 'unknown';
      console.warn(`google sign-in refused: ${code}`);
      return c.json({ error: 'That Google sign-in could not be verified. Try again.' }, 401);
    }

    const recognised = await recognisedAccount(c, auth);
    const guest =
      recognised && recognised.user.accountType === ACCOUNT_TYPES.ANONYMOUS ? recognised.user : null;

    try {
      const existing = await auth.findByIdentity('google', identity.subject);
      let user = existing;
      let merged = 0;

      if (existing) {
        /*
         * This Google account already has a CHAT account. A guest in this
         * browser cannot be upgraded into it — it exists and is not to be
         * overwritten — so their work moves into it, exactly as it does when
         * somebody signs in with a password they had forgotten they had.
         * Nothing is duplicated and nothing is discarded.
         */
        if (guest && guest.id !== existing.id) {
          merged = store.accounts.merge(guest.id, existing.id);
          await auth.merge(guest.id, existing.id);
          clearInstallationCookie(c);
        }
        await auth.touchIdentity('google', identity.subject, identity.email);
      } else {
        /*
         * Nobody has this Google identity yet. A guest in this browser is
         * upgraded in place — same row, same id — so their reflections, drafts
         * and images stay theirs with nothing to migrate.
         */
        /*
         * Before making anybody: is this address already an account?
         *
         * One person, one address, one account. Without this the same mailbox
         * became two accounts the moment somebody who had registered with a
         * password pressed the Google button — the second had none of their
         * reflections, and nothing ever joined them back up.
         *
         * The condition is `emailVerified`, and it is the whole safety of this
         * branch. Google asserting a confirmed address is proof of control of
         * that mailbox, which is exactly what this application accepts as
         * ownership everywhere else: the confirmation link, and the password
         * reset. An address Google merely reports is not proof, and adopting
         * on it would hand somebody's reflections to whoever typed their
         * address into a Google profile. So an unverified address falls
         * through and gets an account of its own, as before.
         */
        const holder =
          identity.emailVerified && identity.email ? await auth.findByEmail(identity.email) : null;

        if (holder && holder.accountType === ACCOUNT_TYPES.REGISTERED) {
          /*
           * Their account, reached a second way. The Google identity is
           * attached to the row that already owns their work — nothing is
           * created, moved or rewritten — and a guest in this browser merges
           * into it exactly as it does when the identity was already known.
           */
          user = await auth.adoptIdentity(holder.id, {
            provider: 'google',
            subject: identity.subject,
            email: identity.email,
            claimUserId: null,
          });
          if (user && guest && guest.id !== user.id) {
            merged = store.accounts.merge(guest.id, user.id);
            await auth.merge(guest.id, user.id);
            clearInstallationCookie(c);
          }
        } else {
          user = await auth.linkIdentity({
            provider: 'google',
            subject: identity.subject,
            email: identity.email,
            claimUserId: guest?.id ?? null,
          });
        }
        /*
         * Null means the identity was claimed between the read and the write.
         * Rather than guess, look again: whoever won is the account to sign
         * in to.
         */
        if (!user) user = await auth.findByIdentity('google', identity.subject);
      }

      if (!user) {
        return c.json({ error: 'That Google account could not be signed in. Try again.' }, 409);
      }

      if (identity.emailVerified) {
        await auth.markEmailVerified(user.id);
        /*
         * Read back, because `user` was fetched before that write.
         *
         * The reply is what the browser keeps as "who I am", so a stale copy
         * here means somebody whose address Google has just vouched for is
         * shown as unverified until they reload — and, now that publishing
         * asks for a confirmed address, told to go and confirm one they have
         * already proved. The next request said the right thing all along,
         * which is exactly what makes this the kind of bug nobody reports
         * precisely.
         */
        user = (await auth.findByIdentity('google', identity.subject)) ?? user;
      }

      const keepSignedIn = body.keepSignedIn === true;
      const installationId = keepSignedIn
        ? await rememberInstallation(c, auth, user.id, PERSISTENCE_TYPES.REGISTERED_PERSISTENT)
        : null;
      /* A fresh session token, so authenticating rotates what identifies it. */
      await beginSession(c, user, { installationId, persistent: keepSignedIn });
      return c.json({ ...accountBody(user), ...(merged > 0 ? { merged } : {}) });
    } catch (error: unknown) {
      console.warn(
        `google sign-in failed after verification: ${error instanceof Error ? error.name : 'unknown'}`,
      );
      return c.json({ error: 'That Google sign-in could not be completed. Try again.' }, 500);
    }
  });

  /*
   * The Google client id, for the browser.
   *
   * Not a secret — Google Identity Services needs it in the page — and served
   * from the environment so the deployed configuration is the single source.
   * The client secret is not read anywhere in this flow, so there is nothing
   * here that could leak one.
   */
  app.get('/api/auth/google/config', (c) =>
    c.json({ clientId: googleClientId, configured: googleClientId !== null }),
  );

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
  /**
   * "I have forgotten my password."
   *
   * The reply never depends on whether that address has an account. Same
   * status, same wording, whether a message was sent or nothing happened at
   * all — a form that says "no account with that email" is a way to find out
   * who writes here, and this is a place people write things they would not
   * say out loud.
   *
   * Which means the failure modes are swallowed on purpose: an address with no
   * account, a guest with no password, mail that is not configured. None of
   * them may be visible from outside.
   */
  /*
   * ── Confirming an address ────────────────────────────────────────────────
   *
   * Two routes, and neither of them signs anybody in. Opening the link proves
   * the mailbox is real and reachable and does exactly that; it creates no
   * session and grants no access by itself. A link found in a forwarded email
   * makes nobody into anybody.
   */
  /*
   * Mint a proof and post it. One implementation, because registration and the
   * resend button must send the same link with the same lifetime — two would
   * be two chances to get the token handling wrong.
   */
  const sendVerificationLink = async (account: AuthUser): Promise<void> => {
    const origin = publicWebOrigin();
    if (!origin || !account.email || account.emailVerified) return;

    const token = newVerificationToken();
    store.emailVerifications.create(
      account.id,
      hashVerificationToken(token),
      Date.now() + VERIFICATION_TTL_MS,
    );
    const message = verificationEmail(verificationUrl(origin, token));
    await mailer.send({ to: account.email, ...message });
  };

  app.post('/api/auth/send-verification', async (c) => {
    const account = await currentAccount(c);

    /*
     * The reply is the same whether or not there was anything to send: signed
     * out, already verified, a guest, or a link genuinely on its way. This
     * route is reachable without an account, so an answer that varied would be
     * a way to ask whether an address is verified here.
     */
    const sendable =
      account !== null &&
      account.accountType === ACCOUNT_TYPES.REGISTERED &&
      !account.emailVerified &&
      Boolean(account.email);

    const limited = verificationLimiter.take(addressOf(c));
    if (sendable && limited.allowed && account) {
      await sendVerificationLink(account).catch((error: unknown) =>
        console.warn('verification mail failed:', error),
      );
    }

    return c.json({ message: VERIFICATION_SENT_MESSAGE });
  });

  app.post('/api/auth/verify-email', async (c) => {
    const body = await c.req.json<{ token?: string }>().catch(() => ({}) as { token?: string });
    const token = body.token?.trim() ?? '';

    const pending = token ? store.emailVerifications?.live(hashVerificationToken(token)) : undefined;
    if (!pending) {
      /*
       * Unknown, expired and already-spent are one answer. Telling them apart
       * would say whether a token was ever real, which is the only thing an
       * attacker holding a guess wants to know.
       */
      return c.json({ error: VERIFICATION_SPENT_MESSAGE }, 400);
    }

    /* Spent first: a replayed link must not be able to be spent twice. */
    store.emailVerifications?.use(pending.id);
    await auth.markEmailVerified(pending.userId);

    /*
     * No session. Whoever opened the link has proved the mailbox, not proved
     * they are its owner sitting at a browser — those are different claims and
     * only one of them was made.
     */
    return c.json({ verified: true, message: 'Your email address is confirmed.' });
  });

  app.post('/api/auth/forgot-password', async (c) => {
    const body = await c.req
      .json<{ email?: string }>()
      .catch(() => ({}) as { email?: string });
    const email = body.email?.trim().toLowerCase() ?? '';

    /*
     * Metered by address, because this route sends email to whatever is typed
     * into it. Refusals are the only thing here that may differ by caller —
     * and they differ by who is asking, never by whose address it is.
     */
    const limited = resetLimiter.take(addressOf(c));
    if (limited.allowed && email.includes('@')) {
      /*
       * Does this domain take mail at all?
       *
       * Asked before anything is sent, because every message to a domain that
       * cannot receive one is a bounce, and enough bounces are what stop the
       * real messages arriving. It costs a cached DNS lookup and it protects
       * the thing every other email in this product depends on.
       *
       * Only a definite "no" stops it. A resolver that could not answer is
       * weather, not a decision, and delaying somebody's reset because DNS
       * hiccupped is the wrong way to be wrong.
       *
       * The reply below does not change either way. Whether the domain can
       * receive mail is not a fact about whether the address has an account.
       */
      const deliverable =
        (await mailDomains.check(email.slice(email.lastIndexOf('@') + 1))) !== 'undeliverable';

      const origin = publicWebOrigin();
      const started =
        origin && deliverable ? await auth.startPasswordReset(email).catch(() => null) : null;
      if (started && origin) {
        const link = resetUrl(origin, started.token);
        const message = resetEmail(link);
        /*
         * Awaited, but never fatal. A mail server that is refusing connections
         * is not a reason to tell somebody their reset failed — and if it were
         * reported, the report would only ever appear for addresses that have
         * an account.
         */
        await mailer
          .send({ to: started.email, ...message })
          .catch((error: unknown) => console.warn('password reset mail failed:', error));
      }
    }

    return c.json({ message: RESET_REQUESTED_MESSAGE });
  });

  /**
   * Setting the new one.
   *
   * On success everything the old password could still reach is closed: the
   * sessions, and the browsers that were remembered. Somebody resetting a
   * password is often somebody who thinks another person has it, and leaving
   * those alive would leave that person exactly where they were.
   */
  app.post('/api/auth/reset-password', async (c) => {
    const body = await c.req
      .json<{ token?: string; password?: string }>()
      .catch(() => ({}) as { token?: string; password?: string });
    const token = body.token?.trim() ?? '';
    const password = body.password ?? '';

    if (password.length < PASSWORD_MIN) {
      return c.json(
        {
          error: `A password of at least ${PASSWORD_MIN} characters is required.`,
          field: 'password',
        },
        400,
      );
    }

    const user = token ? await auth.completePasswordReset(token, password) : null;
    if (!user) {
      /*
       * One answer for expired, used and never-real. Distinguishing them tells
       * somebody holding a stolen link which kind of stolen it is.
       */
      return c.json(
        {
          error:
            'That link has expired or has already been used. Ask for a new one and it will work for an hour.',
          field: 'token',
        },
        400,
      );
    }

    /* Signed in on this browser, deliberately: they have just proved it. */
    await beginSession(c, user, { installationId: null, persistent: false });
    return c.json(accountBody(user));
  });

  /*
   * ── Devices and sessions ─────────────────────────────────────────────────
   *
   * "Where am I signed in, and how do I stop being signed in there?" — which
   * is the question somebody asks after losing a phone, and the only useful
   * answer is a list they can act on.
   *
   * Three rules hold this together:
   *
   *  1. **No token ever leaves.** Each entry is named by the stored key, a
   *     hash; signing in requires the pre-image, which stays in the browser
   *     that holds it. So a list can be shown, and an entry revoked, without
   *     handing a page anything that could be used to sign in.
   *  2. **Registered accounts only.** A guest has one browser by definition —
   *     there is nothing to manage and no second device to be surprised by.
   *  3. **Scoped in the query.** Revocation matches on user id in the WHERE
   *     clause, so another account's session id matches nothing rather than
   *     matching and being refused afterwards.
   */
  app.get('/api/auth/sessions', async (c) => {
    const user = await registeredUser(c);
    if (!user) return c.json({ error: 'Unauthenticated.' }, 401);

    const sessions = store.sessions.listForUser?.(user.id) ?? [];
    const current = getCookie(c, SESSION_COOKIE);
    const currentId = current ? hashSessionToken(current) : null;

    return c.json({
      sessions: sessions.map((session) => ({
        ...session,
        /* Which row is "this device", so it is never revoked by accident. */
        current: session.id === currentId,
      })),
    });
  });

  app.delete('/api/auth/sessions/:id', async (c) => {
    const user = await registeredUser(c);
    if (!user) return c.json({ error: 'Unauthenticated.' }, 401);

    const revoked = store.sessions.revokeById?.(user.id, c.req.param('id')) ?? null;
    if (!revoked) return c.json({ error: 'That session is already signed out.' }, 404);

    /*
     * The device, not only the session.
     *
     * A browser that was kept signed in holds a separate installation
     * credential and would quietly establish a fresh session with it on its
     * next request — so revoking the session alone would leave "sign out that
     * device" untrue. This mirrors what logging out does.
     */
    if (
      revoked.installationId &&
      revoked.sessionType === SESSION_TYPES.REGISTERED_PERSISTENT
    ) {
      await auth.revokeInstallation(revoked.installationId);
    }

    /*
     * Signing out the session making the request is allowed — it is just a
     * sign-out — but the cookie has to go with it, or the browser keeps
     * presenting a token the server has stopped honouring.
     */
    const current = getCookie(c, SESSION_COOKIE);
    if (current && hashSessionToken(current) === c.req.param('id')) {
      deleteCookie(c, SESSION_COOKIE, { path: '/' });
    }
    return c.json({ ok: true });
  });

  app.post('/api/auth/sessions/revoke-others', async (c) => {
    const user = await registeredUser(c);
    if (!user) return c.json({ error: 'Unauthenticated.' }, 401);

    const current = getCookie(c, SESSION_COOKIE);
    if (!current) return c.json({ error: 'Unauthenticated.' }, 401);

    const revoked = store.sessions.revokeOthersForUser?.(user.id, current) ?? [];
    for (const session of revoked) {
      if (session.installationId && session.sessionType === SESSION_TYPES.REGISTERED_PERSISTENT) {
        await auth.revokeInstallation(session.installationId);
      }
    }
    return c.json({ ok: true, revoked: revoked.length });
  });

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
    /*
     * Tags pass the gate before they are stored, and a refused one does not
     * cost the rest of the save. Four good tags and one refused word leaves the
     * four on the reflection, the reflection saved, and one sentence back about
     * the one — losing somebody's other work to a word is not a proportionate
     * response to a word.
     *
     * `refusedTags` is only present when something was refused, so a client can
     * treat its absence as "nothing to say" rather than an empty-array check.
     */
    let refusedTags: { input: string; refusal: string }[] = [];
    if (body.tags !== undefined) {
      const verdict = validateTags(rawTagStrings(body.tags));
      conversation.tags = verdict.accepted;
      refusedTags = verdict.refused;
      if (verdict.accepted.length > 0) {
        /*
         * Recorded as published only when this reflection actually is. A
         * private reflection's tags still become the author's own suggestions;
         * they gain no standing with anybody else until it is shared.
         */
        tagRegistry.record({
          userId: conversation.userId,
          tags: verdict.accepted,
          published: conversation.visibility !== VISIBILITY.PRIVATE,
        });
      }
    } else {
      conversation.tags = conversation.tags ?? [];
    }
    conversation.updatedAt = nowIso();
    store.conversations.set(conversation.id, conversation);
    return c.json({
      ...summaryOf(conversation),
      ...(refusedTags.length > 0
        ? { refusedTags, tagError: refusalMessage() }
        : {}),
    });
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
    /*
     * Four deletes across two stores, as one write.
     *
     * Separately, a failure part-way through left a reflection whose sections
     * were gone, or publications of a reflection that no longer exists. The
     * person asked for this to be deleted; a partial answer is worse than
     * either answer, and this is somebody's writing.
     *
     * The MemoryStore path has no database and no atomicity to offer, so it
     * simply runs them -- it backs unit tests, not anybody's reflections.
     */
    const db = (store as { db?: { exec(sql: string): void } }).db;
    let shares = 0;
    const remove = () => {
      shares = communityStore?.removeSharesOfConversation(conversation.id, owner.id) ?? 0;
      store.sections.delete(conversation.id);
      store.messages.delete(conversation.id);
      store.conversations.delete(conversation.id);
    };

    if (db) {
      db.exec('BEGIN');
      try {
        remove();
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    } else {
      remove();
    }

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
    /*
     * Sharing is the moment this reflection's tags gain standing with anybody
     * else. Until now they ranked for their author alone; they were already in
     * the registry, and this is the count that makes them suggestable to a
     * stranger. Re-validated rather than trusted from storage, because rows
     * written before the gate existed have never been through it.
     */
    const shared = validateTags(rawTagStrings(conversation.tags ?? []));
    if (shared.accepted.length > 0) {
      tagRegistry.record({
        userId: conversation.userId,
        tags: shared.accepted,
        published: true,
      });
    }
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
            address: addressOf(c),
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

  /* Reflections — the user's own work, searched and filtered. */
  /**
   * What a card needs, computed where the sections already are.
   *
   * The collection used to render a list and then ask for every reflection on
   * it, one request per card, to find out what was written in them — twenty
   * round trips to draw one page, and a card that said "Nothing written yet"
   * until its own request came back. This route has already loaded the
   * sections to filter and sort by them; it may as well answer the question.
   *
   * `previewFor` is the shared one, so the line on a card is chosen by the
   * same rule on both sides rather than by two implementations that drift.
   */
  const cardOf = (conversation: StoredConversation) => {
    const stored = store.sections.get(conversation.id);
    const condensed = conversation.format === CHAT_FORMATS.CONDENSED;
    const contents = condensed
      ? (condensedFromStore(stored) as Record<string, { content: string }>)
      : (sectionsFromStore(stored) as Record<string, { content: string }>);

    const order = condensed
      ? (Object.values(CONDENSED_SECTION_TYPES) as string[])
      : (Object.values(CHAT_SECTION_TYPES) as string[]);

    const written = order.filter((type) => (contents[type]?.content ?? '').trim().length > 0);

    /*
     * The excerpt falls back to the person's own messages, because a
     * reflection can be a conversation that has not been shaped into sections
     * yet, and a blank card is not what that is.
     */
    const fromSections = written
      .map((type) => (contents[type]?.content ?? '').trim())
      .find((content) => content.length > 0);
    const fromMessages = (store.messages.get(conversation.id) ?? [])
      .filter((message) => message.role === 'user')
      .map((message) => message.content.trim())
      .find((content) => content.length > 0);

    return {
      ...summaryOf(conversation),
      excerpt: fromSections ?? fromMessages ?? '',
      preview: previewFor(contents, conversation.format as ChatFormat, conversation.scriptureReference),
      written,
    };
  };

  const reflections = async (c: Context) => {
    const owner = await currentAccount(c);
    const parsed = readReflectionFilters({
      get: (name) => c.req.query(name),
    });
    if ('error' in parsed) {
      return c.json({ error: parsed.error }, 400);
    }

    /*
     * Asked for by owner, rather than read whole and sifted.
     *
     * SQLite answers this from idx_conversations_user. The in-memory store has
     * no index and no query language, so it filters -- it backs unit tests,
     * not a database with everybody's writing in it.
     */
    const table = store.conversations as {
      byUser?: (userId: string) => StoredConversation[];
    };
    const mine = !owner
      ? []
      : (table.byUser?.(owner.id) ??
        [...store.conversations.values()].filter(
          (conversation) => conversation.userId === owner.id,
        ));

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
      items: items.slice(start, start + parsed.pageSize).map(cardOf),
      total: items.length,
      page,
      pageSize: parsed.pageSize,
      pageCount,
      tags: tagFacets(mine),
      books: bookFacets(mine),
    });
  };

  app.get('/api/reflections', reflections);

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

  return app;
}

export const app = createApp();
