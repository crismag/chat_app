import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { SESSION_TTL_MS } from './db.ts';
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
  PUBLICATION_STATES,
  TITLE_SOURCES,
  type AiAction,
  type CreateLayout,
  type CreateStyle,
  type HealthResponse,
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
import { createProfileRoutes } from './profile/routes.ts';
import { createProfileStore } from './profile/store.ts';
import { createStudioCreationStore } from './create/store.ts';
import { readStudioCreation } from './create/validation.ts';
import { SqliteStore } from './db.ts';
import { MemoryStore, type StoredConversation } from './store.ts';

const SESSION_COOKIE = 'chat_session';

function hashPassword(password: string, salt = randomBytes(16).toString('hex')): string {
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, expected] = stored.split(':');
  if (!salt || !expected) {
    return false;
  }
  const actual = scryptSync(password, salt, 32);
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}

function nowIso(): string {
  return new Date().toISOString();
}

function summaryOf(conversation: StoredConversation) {
  return {
    id: conversation.id,
    format: conversation.format,
    title: conversation.title,
    scriptureReference: conversation.scriptureReference,
    publicationState: conversation.publicationState,
    updatedAt: conversation.updatedAt,
  };
}

/** Every field name a section row may carry, for validating a write. */
const SECTION_TYPES = [
  ...Object.values(CHAT_SECTION_TYPES),
  ...Object.values(CONDENSED_SECTION_TYPES),
] as const;

type SectionType = (typeof SECTION_TYPES)[number];

const AUTHOR_ORIGIN_VALUES = Object.values(AUTHOR_ORIGINS) as readonly AuthorOrigin[];

/**
 * The session cookie's options.
 *
 * `secure` is on everywhere but development, because without it the browser
 * will send the session token over plain HTTP — which is exactly the situation
 * a session cookie exists to survive. It is off locally only because there is
 * no certificate on localhost and the cookie would otherwise never be set.
 */
const sessionCookie = {
  httpOnly: true,
  sameSite: 'Lax',
  path: '/',
  secure: process.env.NODE_ENV === 'production',
  maxAge: Math.floor(SESSION_TTL_MS / 1000),
} as const;

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
) {
  const app = new Hono();
  const aiService = new AiService(ai);
  const bibleService = new BibleService();
  const biblePassages = createPassageStore(store);
  const studioCreations = createStudioCreationStore(store);

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
      origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
      allowMethods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
    }),
  );

  const currentUser = (c: Context) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (!token) {
      return null;
    }
    const session = store.sessions.get(token);
    if (!session) {
      return null;
    }
    return store.users.get(session.userId) ?? null;
  };

  const requireUser = (c: Parameters<typeof currentUser>[0]) => {
    const user = currentUser(c);
    if (!user) {
      return null;
    }
    return user;
  };

  app.get('/api/health', (c) => {
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
          if (!conversation || conversation.userId !== userId) return null;

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
      currentUser: (c) => currentUser(c),
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
  app.route(
    '/api/profiles',
    createProfileRoutes({
      currentUser: (c) => currentUser(c),
      profiles: createProfileStore(store),
    }),
  );

  app.post('/api/auth/register', async (c) => {
    const body = await c.req.json<{ email?: string; password?: string }>();
    const email = body.email?.trim().toLowerCase() ?? '';
    const password = body.password ?? '';
    if (!email || password.length < 8) {
      return c.json({ error: 'Email and a password of at least 8 characters are required.' }, 400);
    }
    if (store.usersByEmail.has(email)) {
      return c.json({ error: 'An account with that email already exists.' }, 409);
    }
    const user = {
      id: randomUUID(),
      email,
      passwordHash: hashPassword(password),
    };
    store.users.set(user.id, user);
    store.usersByEmail.set(email, user.id);
    const token = randomUUID();
    store.sessions.set(token, { token, userId: user.id });
    setCookie(c, SESSION_COOKIE, token, sessionCookie);
    return c.json({ id: user.id, email: user.email }, 201);
  });

  app.post('/api/auth/login', async (c) => {
    const body = await c.req.json<{ email?: string; password?: string }>();
    const email = body.email?.trim().toLowerCase() ?? '';
    const userId = store.usersByEmail.get(email);
    const user = userId ? store.users.get(userId) : undefined;
    if (!user || !verifyPassword(body.password ?? '', user.passwordHash)) {
      return c.json({ error: 'Invalid email or password.' }, 401);
    }
    const token = randomUUID();
    store.sessions.set(token, { token, userId: user.id });
    setCookie(c, SESSION_COOKIE, token, sessionCookie);
    return c.json({ id: user.id, email: user.email });
  });

  app.post('/api/auth/logout', (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      store.sessions.delete(token);
    }
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.get('/api/auth/me', (c) => {
    const user = currentUser(c);
    if (!user) {
      return c.json({ error: 'Unauthenticated.' }, 401);
    }
    return c.json({ id: user.id, email: user.email });
  });

  app.post('/api/conversations', async (c) => {
    const user = requireUser(c);
    if (!user) {
      return c.json({ error: 'Unauthenticated.' }, 401);
    }
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
      userId: user.id,
      format,
      title: body.title?.trim() || reference || 'New reflection',
      scriptureReference: reference,
      publicationState: PUBLICATION_STATES.PRIVATE,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    store.conversations.set(conversation.id, conversation);
    return c.json(summaryOf(conversation), 201);
  });

  app.get('/api/conversations', (c) => {
    const user = requireUser(c);
    if (!user) {
      return c.json({ error: 'Unauthenticated.' }, 401);
    }
    const items = [...store.conversations.values()]
      .filter((conversation) => conversation.userId === user.id)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(summaryOf);
    return c.json(items);
  });

  const ownedConversation = (c: Parameters<typeof currentUser>[0], id: string) => {
    const user = requireUser(c);
    if (!user) {
      return { error: 401 as const, user: null, conversation: null };
    }
    const conversation = store.conversations.get(id);
    if (!conversation || conversation.userId !== user.id) {
      return { error: 404 as const, user, conversation: null };
    }
    return { error: null, user, conversation };
  };

  app.get('/api/conversations/:id', (c) => {
    const { error, conversation } = ownedConversation(c, c.req.param('id'));
    if (error === 401) {
      return c.json({ error: 'Unauthenticated.' }, 401);
    }
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
    const { error, conversation } = ownedConversation(c, c.req.param('id'));
    if (error === 401) {
      return c.json({ error: 'Unauthenticated.' }, 401);
    }
    if (!conversation) {
      return c.json({ error: 'Conversation not found.' }, 404);
    }
    const body = await c.req
      .json<{ title?: string; scriptureReference?: string | null; format?: ChatFormat }>()
      .catch(() => ({}) as { title?: string; scriptureReference?: string | null; format?: ChatFormat });

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
   */
  app.delete('/api/conversations/:id', (c) => {
    const { error, conversation } = ownedConversation(c, c.req.param('id'));
    if (error === 401) {
      return c.json({ error: 'Unauthenticated.' }, 401);
    }
    if (!conversation) {
      return c.json({ error: 'Conversation not found.' }, 404);
    }
    store.sections.delete(conversation.id);
    store.messages.delete(conversation.id);
    store.conversations.delete(conversation.id);
    return c.json({ id: conversation.id, deleted: true });
  });

  app.post('/api/conversations/:id/messages', async (c) => {
    const { error, conversation } = ownedConversation(c, c.req.param('id'));
    if (error === 401) {
      return c.json({ error: 'Unauthenticated.' }, 401);
    }
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

  app.post('/api/conversations/:id/publish', (c) => {
    const { error, conversation } = ownedConversation(c, c.req.param('id'));
    if (error === 401) {
      return c.json({ error: 'Unauthenticated.' }, 401);
    }
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

    if (!validation.publishable) {
      return c.json({ error: 'This reflection is not ready to publish.', validation }, 422);
    }

    conversation.publicationState = PUBLICATION_STATES.PUBLISHED;
    conversation.updatedAt = nowIso();
    store.conversations.set(conversation.id, conversation);
    return c.json(summaryOf(conversation));
  });

  app.post('/api/conversations/:id/unpublish', (c) => {
    const { error, conversation } = ownedConversation(c, c.req.param('id'));
    if (error === 401) {
      return c.json({ error: 'Unauthenticated.' }, 401);
    }
    if (!conversation) {
      return c.json({ error: 'Conversation not found.' }, 404);
    }
    conversation.publicationState = PUBLICATION_STATES.PRIVATE;
    conversation.updatedAt = nowIso();
    store.conversations.set(conversation.id, conversation);
    return c.json(summaryOf(conversation));
  });

  app.patch('/api/conversations/:id/sections', async (c) => {
    const { error, conversation } = ownedConversation(c, c.req.param('id'));
    if (error === 401) {
      return c.json({ error: 'Unauthenticated.' }, 401);
    }
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
    const { error, user, conversation } = ownedConversation(c, c.req.param('id'));
    if (error === 401) {
      return c.json({ error: 'Unauthenticated.' }, 401);
    }
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
  const reflections = (c: Context) => {
    const user = requireUser(c);
    if (!user) {
      return c.json({ error: 'Unauthenticated.' }, 401);
    }

    const query = (c.req.query('q') ?? '').trim().toLowerCase();
    const filter = c.req.query('filter') ?? 'all';
    const sort = c.req.query('sort') ?? 'recent';

    const mine = [...store.conversations.values()].filter(
      (conversation) => conversation.userId === user.id,
    );

    const items = mine.filter((conversation) => {
      /*
       * "Completed" means the format's own rules are satisfied — the same
       * validator that gates publication — rather than a flag someone
       * remembered to set.
       */
      if (filter !== 'all') {
        const complete =
          validateChat(conversation.format, draftOf(conversation)).missing.length === 0;

        if (filter === 'drafts' && complete) return false;
        if (filter === 'completed' && !complete) return false;
        if (
          filter === 'published' &&
          conversation.publicationState !== PUBLICATION_STATES.PUBLISHED
        ) {
          return false;
        }
      }

      if (!query) return true;

      // Search what the person actually wrote, not only what they titled it.
      const sections = Object.values(
        sectionsFromStore(store.sections.get(conversation.id)),
      ).map((section) => section.content);
      const messages = store.messages.get(conversation.id) ?? [];
      return [
        conversation.title,
        conversation.scriptureReference ?? '',
        ...messages.map((message) => message.content),
        ...sections,
      ]
        .join('\n')
        .toLowerCase()
        .includes(query);
    });

    items.sort((a, b) =>
      sort === 'title'
        ? a.title.localeCompare(b.title)
        : b.updatedAt.localeCompare(a.updatedAt),
    );

    return c.json(items.map(summaryOf));
  };

  app.get('/api/reflections', reflections);
  app.get('/api/library', reflections);

  app.get('/api/community', (c) => {
    const user = requireUser(c);
    if (!user) {
      return c.json({ error: 'Unauthenticated.' }, 401);
    }
    const items = [...store.conversations.values()]
      .filter((conversation) => conversation.publicationState === PUBLICATION_STATES.PUBLISHED)
      .map(summaryOf);
    return c.json(items);
  });

  /*
   * Create Studio remains a controlled component. These endpoints persist its
   * canonical document and release metadata; they never render, interpret a
   * reflection, or expose another user's creation.
   */
  app.get('/api/studio-creations/:conversationId', (c) => {
    const { error, conversation } = ownedConversation(c, c.req.param('conversationId'));
    if (error === 401) return c.json({ error: 'Unauthenticated.' }, 401);
    if (!conversation) return c.json({ error: 'Conversation not found.' }, 404);
    return c.json({ creation: studioCreations.get(conversation.id) });
  });

  app.put('/api/studio-creations/:conversationId', async (c) => {
    const { error, conversation } = ownedConversation(c, c.req.param('conversationId'));
    if (error === 401) return c.json({ error: 'Unauthenticated.' }, 401);
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
    const user = requireUser(c);
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
    const { error, conversation } = ownedConversation(c, body.conversationId);
    if (error === 401) {
      return c.json({ error: 'Unauthenticated.' }, 401);
    }
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
