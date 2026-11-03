import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { resolveWebDist, withWebApp } from './web-app.ts';

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'chat-web-'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>C.H.A.T.</title>');
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'assets', 'app-abc123.js'), 'console.log(1)');
  writeFileSync(join(root, 'sw.js'), 'self');
  writeFileSync(join(root, 'secret.sqlite'), 'nope');
  return root;
}

function server() {
  const api = new Hono();
  api.get('/api/health', (c) => c.json({ status: 'ok' }));
  return withWebApp(api, fixture());
}

describe('one origin for the web app and the API', () => {
  it('hands /api to the API, untouched', async () => {
    const res = await server().request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('answers an unknown API path with a 404, never the app shell', async () => {
    const res = await server().request('/api/nothing-here');
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('<!doctype html>');
  });

  it('serves the app shell for its own routes, so a reload works', async () => {
    const res = await server().request('/reflections/42');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(await res.text()).toContain('<title>C.H.A.T.</title>');
  });

  it('caches hashed assets for good and everything else not at all', async () => {
    const app = server();
    const asset = await app.request('/assets/app-abc123.js');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toContain('immutable');
    const worker = await app.request('/sw.js');
    expect(worker.headers.get('cache-control')).toBe('no-cache');
  });

  it('never serves data files, whatever is in the directory', async () => {
    const res = await server().request('/secret.sqlite');
    expect(res.status).toBe(404);
  });
});

describe('resolveWebDist', () => {
  it('can be switched off for an API-only deployment', () => {
    expect(resolveWebDist({ SERVE_WEB_APP: '0', WEB_DIST_DIR: fixture() })).toBeNull();
  });

  it('is null when nothing has been built', () => {
    expect(resolveWebDist({ WEB_DIST_DIR: mkdtempSync(join(tmpdir(), 'chat-empty-')) })).toBeNull();
  });

  it('finds a built web app', () => {
    const dir = fixture();
    expect(resolveWebDist({ WEB_DIST_DIR: dir })).toBe(dir);
  });
});
