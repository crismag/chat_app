/*
 * The one-process entry point: the web app and the API on one origin.
 *
 *   npm install
 *   npm run build      # builds web_app/dist
 *   npm start          # this file
 *
 * That is the whole install on a managed Node host such as Hostinger's
 * "Node.js Web App" — point the panel at this repository, keep the default
 * build and start commands, and set the environment variables you want. See
 * docs/development/HOSTINGER.md.
 *
 * A plain .mjs on purpose: a host's process manager expects JavaScript. The
 * API is TypeScript that Node runs directly (type stripping), so there is no
 * compile step and no dev dependency at runtime.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const here = import.meta.dirname;

/* ── Node version ─────────────────────────────────────────────────────────
 *
 * The API needs two things from Node itself: running .ts files (unflagged
 * from 22.18) and node:sqlite (unflagged from 22.13). On anything older the
 * failure is a cryptic stack trace, so say what to change instead.
 */
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(
    `C.H.A.T. needs Node.js 22.18 or newer (this is ${process.versions.node}). ` +
      'Choose Node.js 22 (latest) or 24 in your host\'s Node.js settings and redeploy.',
  );
  process.exit(1);
}

/* ── Configuration ────────────────────────────────────────────────────────
 *
 * Variables set in the host's panel always win. A .env file is optional and
 * only fills in what is not already set (loadEnvFile never overwrites).
 */
const dataHome = process.env.CHAT_DATA_DIR?.trim()
  ? resolve(process.env.CHAT_DATA_DIR.trim())
  : join(homedir(), 'chat_app_data');

const envCandidates = [
  process.env.CHAT_ENV_FILE,
  join(here, '.env'),
  join(dataHome, '.env'),
].filter(Boolean);
const envFile = envCandidates.find((path) => existsSync(path));
if (envFile) {
  process.loadEnvFile(envFile);
  console.log(`configuration read from ${envFile}`);
}

process.env.NODE_ENV ??= 'production';

/*
 * The SQLite file must outlive a redeploy.
 *
 * A managed host replaces the application directory on every deploy, so a
 * database inside it is a database that is emptied by the next push. The
 * default lives in the account's home directory instead, outside any web root.
 */
if (!process.env.DATABASE_PATH?.trim()) {
  process.env.DATABASE_PATH = join(dataHome, 'chat.sqlite');
}
mkdirSync(dirname(resolve(process.env.DATABASE_PATH)), { recursive: true });

if (!existsSync(join(here, 'web_app', 'dist', 'index.html'))) {
  console.warn(
    'web_app/dist is missing, so only the API will answer. ' +
      'Run `npm run build` before `npm start` (set it as the build command on your host).',
  );
}

console.log(`data: ${process.env.DATABASE_PATH}`);
await import('./api/src/index.ts');
