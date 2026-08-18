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
| `GEMINI_API_KEY`, `AI_ENABLED` | assistance, off unless switched on |
| `YVP_APP_KEY` | Scripture lookup, on by default but inert without the key |

`NODE_ENV=production` is what marks the session cookie `Secure`, so it is set
by `restart-api.sh` rather than left to the file.

## How /api is served, on this host

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
| Application URL | `reflections.crishub.com/api` |
| Application startup file | `app.mjs` |

Then add the environment from `.env` — the manager runs the process itself, so
`restart-api.sh` is **not** used on this host, and neither are the variables it
would have exported. Set these in the manager alongside the credentials:

```
NODE_ENV=production
DATABASE_PATH=/home/u471078694/domains/reflections.crishub.com/private/chat_app/data/chat.sqlite
CHAT_WEB_ORIGINS=https://reflections.crishub.com
```

After that, and after every deploy, restart the app from hPanel. These answer
whether it worked:

```bash
curl -sS  https://reflections.crishub.com/api/health      # {"status":"ok",…}
curl -sSI https://reflections.crishub.com/reflections     # 200 and the app, not a 404
```

`restart-api.sh` remains for hosts that do let you run your own process; the
nohup test above shows it would work here too if the proxy did.

## Still SQLite

The live store is still SQLite, at `private/chat_app/data/chat.sqlite`. MariaDB
is configured and migrated on boot, but no request handler reads from it yet —
that cutover is in progress. **Back up that file**; it is the whole product.

```bash
cp private/chat_app/data/chat.sqlite ~/backups/chat-$(date +%F).sqlite
```
