# Deploying to reflections.crishub.com

Two things are deployed and they are not alike. The web app is static files
Vite has already built. The API is a Node process that has to stay running.
A host that can serve the first cannot necessarily run the second, and that is
the one thing to establish before anything else.

```
reflections.crishub.com
  public_html/                 the built web app, served directly
    index.html .htaccess assets/
  private/chat_app/
    .env                       credentials — never written by these scripts
    current -> releases/<sha>  the running release
    releases/<sha>/            the last five are kept
    data/chat.sqlite           the live store, outside public_html
    logs/api.log
    api.pid
```

## Why the layout is this way

`public_html` is served to anyone who asks for it. The database, the `.env` and
the logs are ordinary readable files, so none of them may live there — hence
`private/`, and hence `DATABASE_PATH` pointing at `private/chat_app/data`
rather than at the release directory, which is replaced on every deploy.

## Deploying

On your machine:

```bash
./scripts/deploy/build-release.sh          # -> dist/chat_app-<sha>.tar.gz
scp dist/chat_app-<sha>.tar.gz u471078694@…:~/
```

On the host, the first time:

```bash
tar -xzf chat_app-<sha>.tar.gz
bash app/scripts-deploy/preflight.sh       # says what this host can do
bash app/scripts-deploy/remote-install.sh
```

and identically for every deploy after it. `remote-install.sh` installs
production dependencies, applies migrations, repoints `current`, publishes the
web app and restarts the API. Going back a release is repointing the symlink
and running `restart-api.sh`.

## Keeping the API up

The API is a long-running Node process. Started over SSH it **is reaped by the
host** — not predictably and without a message: the log ends with "listening",
and the next line is the next start. While it is gone the PHP gateway answers
502 and the browser shows "Failed to fetch", which to somebody typing a
password is indistinguishable from being told it is wrong.

Two ways to fix it, and the first is better:

1. **hPanel → Setup Node.js App**, configured as below. The panel keeps its own
   process alive and restarts it. This is the intended arrangement.
2. **hPanel → Advanced → Cron Jobs**, running every minute:

   ```
   /home/u471078694/domains/reflections.crishub.com/private/chat_app/current/scripts-deploy/keepalive.sh
   ```

   `keepalive.sh` asks the API whether it is answering and starts it if not. It
   does nothing when the API is up, and writes a line to
   `private/chat_app/logs/keepalive.log` when it acts — so a pattern of
   restarts is visible rather than silent.

There is no `crontab` command on this host; cron is hPanel-only, so neither of
these can be installed from a deploy script.

## Sending mail

Password reset needs somewhere to send from. Four values in `.env`:

```
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_USER=chat_app@crishub.com
SMTP_PASSWORD=
SMTP_FROM=chat_app@crishub.com
```

Without them the application still runs and the reset route still answers
exactly as it does otherwise — the link is written to `logs/api.log` marked
`MAIL NOT CONFIGURED` instead of being sent. That is deliberate: the reply to
"I forgot my password" must never differ according to whether a message
actually went, or the form becomes a way to find out who has an account.

## No build step on the host

The remote installs `--omit=dev` and runs the API's TypeScript directly with
`node --experimental-strip-types`. That works because `tsconfig` sets
`erasableSyntaxOnly` — no enums, namespaces or parameter properties — and it is
checked by `build-release.sh` before a bundle is produced.

This matters more than it looks: `api`'s `start` script uses `tsx`, which is a
**dev** dependency. A deployment that ran `npm ci --omit=dev` and then `npm
start` would install cleanly and fail to boot.

`argon2` is native but ships prebuilt binaries for linux-x64 (glibc and musl),
so nothing compiles on the host.

## Configuration precedence

`node --env-file` does not overwrite a variable that is already set. The deploy
scripts export `PORT`, `DATABASE_PATH`, `NODE_ENV` and `CHAT_WEB_ORIGINS`, so
those **win over `.env`** — setting them in `.env` has no effect. Everything
else comes from `.env`:

| | |
| --- | --- |
| `MYSQL_*` | the Hostinger MariaDB, and what migrations run against |
| `SMTP_*` | sending mail. Without it a password-reset link is written to the log instead of being sent, and the route still answers identically — see below |
| `GEMINI_API_KEY`, `AI_ENABLED` | assistance, off unless switched on |
| `YVP_APP_KEY` | Scripture lookup, on by default but inert without the key |

### Aliases, if a host names things differently

`reflections.crishub.com` now uses the application's own names, so nothing is
mapped there. `env-map.sh` remains for a host that does not: it fills in
`MYSQL_*` from `DB_*` and `YVP_APP_KEY` from `YOUVERSION_API_KEY`, strips
surrounding quotes the way `--env-file` does, and never overwrites a name the
application already understands. Nothing on disk is renamed — a credentials
file is a bad thing for a deploy script to rewrite.

**`AI_ENABLED` is deliberately not derived from the presence of a key.**
Assistance sends someone's private reflection to a third party, so it stays off
until that is switched on on purpose.

`NODE_ENV=production` is what marks the session cookie `Secure`, so it is set
by `restart-api.sh` rather than left to the file.

## The API answers on chatapi.crishub.com

A separate domain with its own document root
(`~/domains/chatapi.crishub.com/public_html`), and the web app is built against
`https://chatapi.crishub.com/api`. The `/api` path is kept: the routes are
defined as `/api/...` and nothing strips it.

**How it is reached.** The Node process is expected on `127.0.0.1:8000`, and
the PHP gateway assumes exactly that. It is worth knowing that this is a
convention, not something the code enforces: `api/src/index.ts` calls
`serve({ fetch, port })` with no `hostname`, so the process binds every
interface and only the host's firewall keeps `:8000` private. Binding to
loopback in production is a pending change. Nothing else on this plan could
reach it: a `[P]` rewrite answers 503 because mod_proxy is
not permitted, and the host's Node application manager can only be set up
through its control panel. PHP can open a loopback socket, so
`chatapi/index.php` carries the request in and the answer back out. It is
installed into the API domain's own document root by `remote-install.sh`.

It forwards and does not decide: no headers of its own, no view on who may
call, nothing rewritten. The API behind it already does CORS, sessions and
authentication, and a proxy with opinions about those would be a second place
for them to disagree. The destination is fixed in the file, so no request can
point it elsewhere.

If the Node application manager is ever set up instead, delete `index.php` and
let it own the domain — the two must not both answer.

**Why a separate domain and not a path on the site.** mod_proxy is not
permitted here, so `/api` cannot be handed to a local process — a `[P]` rewrite
answers 503. A subdomain *of* reflections.crishub.com was tried and cannot
help: this host will only root one inside the site's own `public_html`, which
made every file the API served also readable at `reflections.crishub.com/api/…`
— demonstrated with a file that came back 200 from both. `chatapi.crishub.com`
has its own root, so there is no overlap to defend against.

**Cross-origin needs nothing new.** `cors()` runs on `/api/*` with
`credentials: true` and reads `CHAT_WEB_ORIGINS`, which the deployment sets to
`https://reflections.crishub.com`. The session cookie still arrives: both hosts
sit under `crishub.com`, so they are the same *site* even though they are
different origins, and a `SameSite=Lax` cookie is sent.

`.htaccess` still answers 404 for `/api` on the site, before checking whether
the path exists. Nothing lives there now, but the rule also stops the
single-page fallback answering an API call with `index.html` and a 200.

The base URL is baked in at build time — Vite replaces `import.meta.env` when
it compiles — so changing it is a rebuild, not a restart:

```bash
VITE_API_BASE_URL=https://elsewhere.example/api ./scripts/deploy/build-release.sh
```

## How /api was served before, and why it is not

Settled by testing rather than assumption, on reflections.crishub.com:

| | |
| --- | --- |
| `RewriteRule … [P]` to `127.0.0.1` | **503.** Tested with a listener confirmed answering on the loopback — mod_proxy is not permitted on this plan |
| a background `node` started with `nohup` | **survives logout.** Still answering after the SSH session ended |
| `node` on the host | 22.18.0 at `/opt/alt/alt-nodejs22/root/usr/bin`, and `--experimental-strip-types` works |
| `cloudlinux-selector` CLI | not available; the Node app can only be created in hPanel |

So the API is mounted by **hPanel → Setup Node.js App**, not by a proxy rule.
`.htaccess` therefore carries no `/api` rule at all: the manager writes its own
above it, and a rule here would shadow them.

Create the application once, in hPanel:

| field | value |
| --- | --- |
| Node.js version | 22 |
| Application mode | Production |
| Application root | `domains/reflections.crishub.com/private/chat_app/current` |
| Application URL | `chatapi.crishub.com` |
| Application startup file | `app.mjs` |

Nothing needs to be typed into the manager's environment editor. `app.mjs`
reads `private/chat_app/.env` itself, because a managed host runs the startup
file directly and does not pass `--env-file` — without that, the app would boot
with no credentials, skip its migrations and report assistance and Scripture as
switched off: three symptoms of one missing file, none of which name it.

Anything the manager *does* set still wins; `loadEnvFile` has the same
precedence as `--env-file` and leaves an already-set variable alone.

So `.env` is the single place configuration lives, and it needs the names the
application reads:

```
NODE_ENV=production
DATABASE_PATH=/home/u471078694/domains/reflections.crishub.com/private/chat_app/data/chat.sqlite
CHAT_WEB_ORIGINS=https://reflections.crishub.com
MYSQL_HOST= MYSQL_USER= MYSQL_PASSWORD= MYSQL_DATABASE=
YVP_APP_KEY=
GEMINI_API_KEY=
AI_ENABLED=1        # assistance is off without this, key or no key
```

After that, and after every deploy, restart the app from hPanel. These answer
whether it worked:

```bash
curl -sS  https://reflections.crishub.com/api/health      # {"status":"ok",…}
curl -sSI https://reflections.crishub.com/reflections     # 200 and the app, not a 404
```

`restart-api.sh` remains for hosts that do let you run your own process; the
nohup test above shows it would work here too if the proxy did.

## Two stores, two backups

This deployment keeps its data in **two** places, and a backup of one is not a
backup of the product:

- **Accounts are on MariaDB** when `MYSQL_*` is set. `api/src/index.ts` selects
  `MysqlAuthStore`, so users, credentials, sessions and installations live
  there — not in the SQLite file.
- **Content is on SQLite**, at `private/chat_app/data/chat.sqlite`: reflections,
  community publications, profiles, Studio documents and cached passages.

Restoring one without the other gives you accounts nobody can write with, or
writing that belongs to nobody. Take both, at the same time:

```bash
cp private/chat_app/data/chat.sqlite ~/backups/chat-$(date +%F).sqlite
mysqldump -u "$MYSQL_USER" -p "$MYSQL_DATABASE" > ~/backups/chat-accounts-$(date +%F).sql
```
