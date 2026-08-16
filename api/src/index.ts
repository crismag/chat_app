import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { SqliteStore } from './db.ts';
import { DeterministicStudioImageProvider } from './create/image-provider.ts';

const port = Number(process.env.PORT ?? 8000);

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
