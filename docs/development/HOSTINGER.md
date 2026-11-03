# Installing on Hostinger (the simple way)

C.H.A.T. now runs as **one Node.js app**: the same process serves the website
and the API on the same domain. No PHP gateway, no second `chatapi` domain, no
`.htaccess`, no CORS settings, no SSH.

> The older split deployment (static site + API on a separate domain + PHP
> gateway) still works and is documented in
> [`scripts/deploy/README.md`](../../scripts/deploy/README.md). You do not need
> it for a new install.

## What you need

- A Hostinger plan that offers **Node.js Web Apps** (Business web hosting or a
  Cloud plan). The panel calls it *Websites → Add website → Node.js Apps*.
- This repository on GitHub, or a `.zip` of it.

## Install in hPanel

1. **Websites → Add website → Node.js Apps.**
2. Choose **Import Git repository** (connect GitHub and pick this repo and
   branch) — or **Upload your website files** and upload a zip of the repo
   (without `node_modules`).
3. In **Build settings**, use these values (most are detected automatically):

   | Field | Value |
   | --- | --- |
   | Framework preset | Other / Express (anything that is not "static") |
   | Node.js version | **22** (latest 22.x) or **24** — anything older will not start |
   | Root directory | `/` (the repository root) |
   | Install command | `npm install` |
   | Build command | `npm run build` |
   | Start command | `npm start` |
   | Entry file | `server.mjs` |
   | Output directory | leave empty |

4. Add the **environment variables** below (all optional to get it running).
5. **Deploy.** When it finishes, open the site — then check
   `https://YOUR-DOMAIN/api/health`, which should answer `{"status":"ok",…}`.

Every later deploy is pushing to the branch (or uploading a new zip) and
pressing **Redeploy**.

## Environment variables

Nothing is required to boot. The app starts with a local SQLite database and
the full manual writing workflow. Add what you want switched on:

| Variable | What it does |
| --- | --- |
| `CHAT_PUBLIC_WEB_ORIGIN` | Your site's address, e.g. `https://reflections.example.com`. **Set this** — password-reset emails need it to build their link. |
| `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` | Your Hostinger MariaDB (hPanel → Databases). With these, accounts live in MariaDB; tables are created on start. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Sending email (e.g. `smtp.hostinger.com`, `465`). |
| `YVP_APP_KEY` | Scripture lookup (YouVersion). |
| `AI_ENABLED=true`, `AI_PROVIDER=gemini`, `GEMINI_API_KEY` | Optional AI assistance. Off unless you switch it on. |
| `GOOGLE_CLIENT_ID` | "Sign in with Google". |

You do **not** need `PORT`, `NODE_ENV`, `CHAT_WEB_ORIGINS` or
`VITE_API_BASE_URL` for this install: the host sets the port, production is the
default, and the site and API share one origin.

Instead of typing variables into the panel you can put a `.env` file at
`~/chat_app_data/.env` (File Manager, your home folder). Panel values win over
the file.

## Where the data lives

The SQLite database is kept at **`~/chat_app_data/chat.sqlite`** — in your
home folder, outside the app folder — because a redeploy replaces the app
folder, and a database inside it would be wiped on every deploy. Change it with
`DATABASE_PATH` or `CHAT_DATA_DIR` if you want it elsewhere.

When MariaDB is configured, accounts live there and content lives in SQLite, so
back up both at the same time.

## If the install fails

| Symptom | Cause and fix |
| --- | --- |
| Log says `C.H.A.T. needs Node.js 22.18 or newer` | Pick Node.js 22 (latest) or 24 in the app's settings and redeploy. |
| `npm install` fails mentioning `vendor/crismag-create-studio-0.1.0.tgz` | The `vendor/` folder is missing from the upload. Include it (it is committed in the repo). |
| The site shows nothing, and the log says `web_app/dist is missing` | The build command did not run. Set **Build command** to `npm run build`. |
| Signing in does nothing, or you are signed out straight away | The site must be served over **https** (the session cookie is `Secure`). Turn on SSL for the domain in hPanel. |
| Password-reset emails have no link | Set `CHAT_PUBLIC_WEB_ORIGIN`. |
| 502/503 after deploy | Open the app's **Logs** in hPanel. The first lines after start name the problem (Node version, database credentials rejected, …). |

## Installing it on a phone

Once deployed over https, open the site on the phone:

- **Android (Chrome):** menu ⋮ → *Install app*, or the in-app menu's
  **Install app** row.
- **iPhone (Safari):** Share → *Add to Home Screen* (the in-app menu says so).

It then opens full-screen from the home screen like a native app.

## Run the same thing locally

```bash
npm install
npm run build
npm start          # http://localhost:8000
```
