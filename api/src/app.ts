import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { SESSION_TTL_MS } from './db.ts';
import {
  CHAT_FORMATS,
  validateChat,
  type ChatFormat,
  AI_ACTIONS,
  CREATE_LAYOUTS,
  CREATE_STYLES,
  PUBLICATION_STATES,
  type AiAction,
  type CreateLayout,
  type CreateStyle,
  type HealthResponse,
} from '@chat/shared';
import { applyNamedAiAction, extractChatSections, sectionsFromStore } from './ai.ts';
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
 */
export function createApp(store: MemoryStore | SqliteStore = new SqliteStore()) {
  const app = new Hono();

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
    store.messages.set(conversation.id, []);
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
    return c.json({
      ...summaryOf(conversation),
      messages: store.messages.get(conversation.id) ?? [],
      sections: sectionsFromStore(store.sections.get(conversation.id)),
    });
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
    const messages = store.messages.get(conversation.id) ?? [];
    messages.push(message);
    store.messages.set(conversation.id, messages);
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
    const sections = sectionsFromStore(store.sections.get(conversation.id));
    const validation = validateChat(
      conversation.format,
      {
        title: conversation.title,
        scriptureReference: conversation.scriptureReference ?? '',
        context: sections.context.content,
        heart: sections.heart.content,
        application: sections.application.content,
        testimony: sections.testimony.content,
      },
      { extensionAcknowledged: c.req.query('acknowledgeExtension') === 'true' },
    );

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
      type?: 'context' | 'heart' | 'application' | 'testimony';
      content?: string;
    }>();
    if (!body.type) {
      return c.json({ error: 'Section type is required.' }, 400);
    }
    const current = sectionsFromStore(store.sections.get(conversation.id));
    current[body.type] = {
      type: body.type,
      content: body.content ?? '',
      authorOrigin: 'user',
    };
    store.sections.set(conversation.id, current);
    conversation.updatedAt = nowIso();
    store.conversations.set(conversation.id, conversation);
    return c.json({ sections: current });
  });

  app.post('/api/conversations/:id/ai', async (c) => {
    const { error, conversation } = ownedConversation(c, c.req.param('id'));
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

    const messages = store.messages.get(conversation.id) ?? [];

    if (action === AI_ACTIONS.EXTRACT_CHAT) {
      const sections = extractChatSections(messages);
      store.sections.set(conversation.id, sections);
      conversation.updatedAt = nowIso();
      store.conversations.set(conversation.id, conversation);
      return c.json({ action, sections });
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
      messages.push(assistantMessage);
      store.messages.set(conversation.id, messages);
      conversation.updatedAt = assistantMessage.createdAt;
      store.conversations.set(conversation.id, conversation);
      return c.json({
        action,
        original: target.content,
        revised: result.revised,
        replaced: false,
        message: assistantMessage,
      });
    }

    return c.json({
      action,
      original: target.originalContent,
      revised: result.revised,
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
        const sections = sectionsFromStore(store.sections.get(conversation.id));
        const complete = validateChat(conversation.format, {
          title: conversation.title,
          scriptureReference: conversation.scriptureReference ?? '',
          context: sections.context.content,
          heart: sections.heart.content,
          application: sections.application.content,
          testimony: sections.testimony.content,
        }).missing.length === 0;

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
