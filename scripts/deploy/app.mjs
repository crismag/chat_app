/*
 * Process entry point.
 *
 * A plain .mjs so a process manager that expects JavaScript — Passenger, the
 * host's Node application manager, pm2, a systemd unit — has something to
 * point at. It does nothing but load configuration and start the API, which is
 * TypeScript that Node runs directly.
 *
 * Node's type stripping is enough for this codebase because `tsconfig` sets
 * `erasableSyntaxOnly`: there are no enums, namespaces or parameter properties
 * for it to trip over. That is why the remote needs no build step and no tsx.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/*
 * Read .env here rather than relying on the launcher.
 *
 * `restart-api.sh` starts this with `--env-file`, but a managed host does not:
 * it runs this file directly, and then nothing in the environment would carry
 * the database credentials or the API keys. The app would boot, skip its
 * migrations, and report assistance and Scripture as switched off — three
 * symptoms of one missing file, none of which name it.
 *
 * `loadEnvFile` has the same precedence as `--env-file`: a variable already in
 * the environment is left alone. So a manager that does set its own values
 * still wins, and loading here cannot override it.
 */
const here = dirname(new URL(import.meta.url).pathname);
const candidates = [
  process.env.CHAT_ENV_FILE,
  // <private>/chat_app/.env, from <private>/chat_app/releases/<sha>/app.mjs
  resolve(here, '..', '..', '.env'),
  // and from a flat layout, where the app root holds its own .env
  join(here, '.env'),
].filter(Boolean);

const envFile = candidates.find((path) => existsSync(path));
if (envFile) {
  process.loadEnvFile(envFile);
  console.log(`configuration read from ${envFile}`);
} else {
  console.warn(
    `no .env found; looked in: ${candidates.join(', ')}. ` +
      'The API will start, but without credentials it cannot reach the database, ' +
      'Scripture or assistance. Set CHAT_ENV_FILE if it lives elsewhere.',
  );
}

process.env.NODE_ENV ??= 'production';
await import('./api/src/index.ts');
