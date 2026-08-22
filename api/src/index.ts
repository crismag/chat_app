import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { SqliteStore } from './db.ts';
import { DeterministicStudioImageProvider } from './create/image-provider.ts';
import { createMysqlPool, migrate, MysqlPersistence, readMysqlConfig } from './mysql/index.ts';
import { MysqlAuthStore, SqliteAuthStore, type AuthStore } from './auth/store.ts';
import { hashPassword, verifyPassword } from './auth/local-password.ts';

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
 * In production this listens on loopback only.
 *
 * The deployment already assumes it: `scripts/deploy/chatapi/index.php` opens
 * a socket to 127.0.0.1:8000 because the host does not permit mod_proxy, and
 * the deploy guide describes the port as unreachable. It was not — the process
 * bound every interface, and only a firewall stood between the open internet
 * and a port where guest creation, registration and forgot-password are
 * metered by address alone. A caller who can reach it directly can also set
 * `x-forwarded-for`, which is a fresh rate-limit bucket per request.
 *
 * Development binds everywhere on purpose, so a phone on the same network can
 * reach a dev server, and Capacitor's live reload works.
 */
const hostname = process.env.NODE_ENV === 'production' ? '127.0.0.1' : undefined;

serve({
  fetch: createApp(
    store,
    {},
    studioImageProvider ? { provider: studioImageProvider } : {},
    auth ?? new SqliteAuthStore(store, hashPassword, verifyPassword),
  ).fetch,
  port,
  ...(hostname ? { hostname } : {}),
}, () => {
  console.log(
    `C.H.A.T. API listening on http://${hostname ?? 'localhost'}:${port}` +
      (hostname ? ' (loopback only; reached through the gateway)' : ''),
  );
});
