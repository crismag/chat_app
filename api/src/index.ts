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

serve({
  fetch: createApp(
    store,
    {},
    studioImageProvider ? { provider: studioImageProvider } : {},
    auth ?? new SqliteAuthStore(store, hashPassword, verifyPassword),
  ).fetch,
  port,
}, () => {
  console.log(`C.H.A.T. API listening on http://localhost:${port}`);
});
