import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.ts';
import { SqliteStore } from '../db.ts';
import { MemoryStore } from '../store.ts';

async function register(app: ReturnType<typeof createApp>, email: string) {
  const response = await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'secret12' }),
  });
  return response.headers.get('set-cookie') ?? '';
}

async function createReflection(app: ReturnType<typeof createApp>, cookie: string) {
  const response = await app.request('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ title: 'A saved card', scriptureReference: 'John 15:5' }),
  });
  return (await response.json()) as { id: string };
}

const document = {
  schemaVersion: 2,
  id: 'studio.reflection-1',
  pages: [
    {
      id: 'page.square',
      width: 1080,
      height: 1080,
      background: { kind: 'solid', color: '#f6efe4' },
      elements: [],
    },
  ],
};

describe('Studio creation persistence', () => {
  test('an owner can save and reopen a canonical document with export metadata', async () => {
    const app = createApp(new MemoryStore());
    const cookie = await register(app, 'studio@example.com');
    const reflection = await createReflection(app, cookie);
    const path = `/api/studio-creations/${reflection.id}`;

    const empty = await app.request(path, { headers: { Cookie: cookie } });
    expect(await empty.json()).toEqual({ creation: null });

    const saved = await app.request(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        document,
        template: { id: 'chat.square-reflection', version: 1 },
        exportMetadata: {
          exportedAt: '2026-08-16T12:00:00.000Z',
          format: 'image/png',
          width: 1080,
          height: 1080,
        },
      }),
    });
    expect(saved.status).toBe(200);

    const reopened = await app.request(path, { headers: { Cookie: cookie } });
    const body = (await reopened.json()) as { creation: { document: unknown; templateId: string } };
    expect(body.creation.document).toEqual(document);
    expect(body.creation.templateId).toBe('chat.square-reflection');

    await app.request(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ document, template: { id: 'chat.square-reflection', version: 1 } }),
    });
    const savedAgain = await app.request(path, { headers: { Cookie: cookie } });
    expect(await savedAgain.json()).toEqual({
      creation: expect.objectContaining({
        exportMetadata: expect.objectContaining({ exportedAt: '2026-08-16T12:00:00.000Z' }),
      }),
    });
  });

  test('another user cannot discover or overwrite a saved creation', async () => {
    const app = createApp(new MemoryStore());
    const owner = await register(app, 'owner-studio@example.com');
    const stranger = await register(app, 'stranger-studio@example.com');
    const reflection = await createReflection(app, owner);
    const response = await app.request(`/api/studio-creations/${reflection.id}`, {
      headers: { Cookie: stranger },
    });
    expect(response.status).toBe(404);
  });

  test('rejects credentials and temporary signed URLs at the host boundary', async () => {
    const app = createApp(new MemoryStore());
    const cookie = await register(app, 'safe-studio@example.com');
    const reflection = await createReflection(app, cookie);
    const response = await app.request(`/api/studio-creations/${reflection.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        document: {
          ...document,
          metadata: { apiKey: 'do-not-store', image: 'https://example.test/a?token=temporary' },
        },
        template: { id: 'chat.square-reflection', version: 1 },
      }),
    });
    expect(response.status).toBe(400);
  });

  test('reopens a saved Studio document after the SQLite host restarts', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'chat-studio-'));
    const location = join(directory, 'chat.sqlite');
    try {
      const firstStore = new SqliteStore(location);
      const firstApp = createApp(firstStore);
      const cookie = await register(firstApp, 'restart-studio@example.com');
      const reflection = await createReflection(firstApp, cookie);
      await firstApp.request(`/api/studio-creations/${reflection.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          document,
          template: { id: 'chat.square-reflection', version: 1 },
        }),
      });
      firstStore.close();

      const secondStore = new SqliteStore(location);
      const secondApp = createApp(secondStore);
      const reopened = await secondApp.request(`/api/studio-creations/${reflection.id}`, {
        headers: { Cookie: cookie },
      });
      expect(reopened.status).toBe(200);
      expect(await reopened.json()).toEqual({
        creation: expect.objectContaining({ document, templateId: 'chat.square-reflection' }),
      });
      secondStore.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
