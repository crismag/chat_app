import { serve } from '@hono/node-server';
import { createApp } from './app.ts';

const port = Number(process.env.PORT ?? 8000);

serve({ fetch: createApp().fetch, port }, () => {
  console.log(`C.H.A.T. API listening on http://localhost:${port}`);
});
