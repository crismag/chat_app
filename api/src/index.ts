import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { SqliteStore } from './db.ts';

const port = Number(process.env.PORT ?? 8000);

/*
 * A file on disk, so accounts and reflections survive a restart. Override with
 * DATABASE_PATH to point somewhere persistent in a deployment.
 */
const store = new SqliteStore(process.env.DATABASE_PATH ?? 'chat.sqlite');

serve({ fetch: createApp(store).fetch, port }, () => {
  console.log(`C.H.A.T. API listening on http://localhost:${port}`);
});
