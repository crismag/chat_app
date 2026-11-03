import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';

/*
 * One process, one origin: the built web app and the API together.
 *
 * This is what makes a "Node.js app" install on a managed host (Hostinger's
 * hPanel, Render, Railway, a plain VPS) a two-field job — build command and
 * start command — instead of a static site on one domain, an API on another,
 * and a PHP gateway between them. Everything under /api is the API exactly as
 * before; every other GET is a file from web_app/dist, or index.html so the
 * single-page app owns its own routes on a reload.
 *
 * Same origin also means no CORS, no CHAT_WEB_ORIGINS and no VITE_API_BASE_URL:
 * the web build's default `/api` is already right.
 */

/** web_app/dist, found relative to this file so the working directory does not matter. */
export function defaultWebDist(): string {
  return resolve(import.meta.dirname, '..', '..', 'web_app', 'dist');
}

/** The directory to serve, or null when there is no built web app to serve. */
export function resolveWebDist(env: NodeJS.Dict<string> = process.env): string | null {
  const setting = env.SERVE_WEB_APP?.trim().toLowerCase();
  if (setting === '0' || setting === 'false' || setting === 'no') return null;
  const dir = env.WEB_DIST_DIR?.trim() ? resolve(env.WEB_DIST_DIR.trim()) : defaultWebDist();
  return existsSync(join(dir, 'index.html')) ? dir : null;
}

export function withWebApp(api: { fetch: (request: Request, env?: unknown) => Response | Promise<Response> }, root: string): Hono {
  const app = new Hono();
  const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');

  // The API keeps every path it had, untouched. A path under /api the API does
  // not know answers the API's own 404 — never index.html with a 200, which a
  // browser would try to parse as JSON and report as an unrelated fault.
  app.all('/api/*', (c) => api.fetch(c.req.raw, c.env));
  app.all('/api', (c) => api.fetch(c.req.raw, c.env));

  // Nothing that looks like source or data is ever served, whatever is in dist.
  app.get('*', async (c, next) => {
    if (/\.(env|sqlite3?|sqlite-wal|sqlite-shm|ts|map)$/i.test(c.req.path)) return c.notFound();
    await next();
  });

  // Hashed assets never change; anything else must be re-checked, or a deploy
  // stays invisible until somebody clears their cache. Set on the finished
  // response: serveStatic's own onFound hook runs after a GET's body is built,
  // so a header set there reaches HEAD requests and silently misses GETs.
  app.use('*', async (c, next) => {
    await next();
    if (c.res.ok && !c.res.headers.has('Cache-Control')) {
      c.res.headers.set(
        'Cache-Control',
        c.req.path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    }
  });

  app.use('*', serveStatic({ root }));

  // Every other GET is one of the app's own routes.
  app.get('*', (c) => {
    c.header('Cache-Control', 'no-cache');
    return c.html(indexHtml);
  });

  return app;
}
