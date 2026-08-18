import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { SqliteStore } from './db.ts';
import { DeterministicStudioImageProvider } from './create/image-provider.ts';
import { createMysqlPool, migrate, readMysqlConfig } from './mysql/index.ts';

const port = Number(process.env.PORT ?? 8000);

/*
 * SQLite remains the live application store so the demonstrable app keeps
 * working. When MYSQL_* is configured, apply the durable schema on boot
 * without exposing credentials or switching request handlers in this phase.
 */
const mysql = readMysqlConfig();
if (mysql) {
  const pool = createMysqlPool(mysql);
  await migrate(pool);
  await pool.end();
  console.log('MySQL schema is up to date.');
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
  fetch: createApp(store, {}, studioImageProvider ? { provider: studioImageProvider } : {}).fetch,
  port,
}, () => {
  console.log(`C.H.A.T. API listening on http://localhost:${port}`);
});
