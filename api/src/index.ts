import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { SqliteStore } from './db.ts';
import { DeterministicStudioImageProvider } from './create/image-provider.ts';
import { createMysqlPool, migrate, MysqlPersistence, readMysqlConfig } from './mysql/index.ts';
import { MysqlAuthStore, SqliteAuthStore, type AuthStore } from './auth/store.ts';
import { hashPassword, verifyPassword } from './auth/local-password.ts';
import { resolveWebDist, withWebApp } from './web-app.ts';

const port = Number(process.env.PORT ?? 8000);

/*
 * Accounts are the first thing to leave SQLite.
 *
 * The pool stays open for the life of the process now rather than being closed
 * after the migration — it serves every sign-in. Reflections and everything
 * else still read SQLite, which is why both stores are constructed here; the
 * retirement is happening a surface at a time rather than in one commit.
 */
const mysql = readMysqlConfig();
let auth: AuthStore | null = null;
if (mysql) {
  const pool = createMysqlPool(mysql);
  await migrate(pool);
  auth = new MysqlAuthStore(new MysqlPersistence(pool));
  console.log('MySQL schema is up to date; accounts are served from MariaDB.');
}

/*
 * A file on disk, so accounts and reflections survive a restart. Override with
 * DATABASE_PATH to point somewhere persistent in a deployment.
 */
const store = new SqliteStore(process.env.DATABASE_PATH ?? 'chat.sqlite');
const studioImageProvider = process.env.STUDIO_IMAGE_PROVIDER === 'deterministic'
  ? new DeterministicStudioImageProvider()
  : undefined;

/*
 * The built web app, when there is one to serve.
 *
 * `npm run build` then `npm start` at the repository root gives one process
 * that answers the site and the API on the same origin — the simple install a
 * managed Node host expects. Set SERVE_WEB_APP=0 to run the API alone, as the
 * split deployment in scripts/deploy/ does.
 */
const webDist = resolveWebDist();

/*
 * Which interface to listen on.
 *
 * API-only in production listens on loopback only. The split deployment
 * already assumes it: `scripts/deploy/chatapi/index.php` opens a socket to
 * 127.0.0.1:8000 because the host does not permit mod_proxy. Bound to every
 * interface, only a firewall stood between the open internet and a port where
 * guest creation, registration and forgot-password are metered by address.
 *
 * Serving the web app as well, this process IS the front door: the host's
 * proxy has to reach it, and on some managed hosts that proxy is not on the
 * loopback. Rate limiting stays safe either way, because `x-forwarded-for` is
 * believed only from a loopback peer (see http/address.ts).
 *
 * HOST overrides both. Development binds everywhere on purpose, so a phone on
 * the same network can reach a dev server, and Capacitor's live reload works.
 */
const hostname = process.env.HOST?.trim()
  || (process.env.NODE_ENV === 'production' && !webDist ? '127.0.0.1' : undefined);

const api = createApp(
  store,
  {},
  studioImageProvider ? { provider: studioImageProvider } : {},
  auth ?? new SqliteAuthStore(store, hashPassword, verifyPassword),
);

serve({
  fetch: webDist ? withWebApp(api, webDist).fetch : api.fetch,
  port,
  ...(hostname ? { hostname } : {}),
}, () => {
  console.log(
    `C.H.A.T. ${webDist ? 'web app + API' : 'API'} listening on http://${hostname ?? 'localhost'}:${port}` +
      (hostname === '127.0.0.1' ? ' (loopback only; reached through the gateway)' : ''),
  );
  if (webDist) console.log(`serving the web app from ${webDist}`);
});
