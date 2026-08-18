# Mobile packaging

C.H.A.T. is one web application. Android and iOS are Capacitor hosts around
that build, not separate products. Behaviour that can live in TypeScript stays
in `web_app/`. Native plugins exist only for share, saving an image, keyboard
and status-bar chrome, and opening a deep link.

## Prerequisites

- Node.js 22+ (see `.nvmrc`)
- Android Studio Ladybug or newer, JDK 21, for Android binaries
- Xcode 16+, CocoaPods, for iOS binaries (macOS only)

The Linux development machine can generate and sync both native projects. It
cannot produce a signed iOS IPA.

## Commands

From the repository root:

```bash
npm install
npm run cap:sync
```

`cap:sync` builds `web_app` into `web_app/dist`, then copies that bundle and
the plugin native code into `android/` and `ios/`. Copied web assets are
gitignored; sync them after clone before opening an IDE.

```bash
npm run cap:android   # sync, then open Android Studio
npm run cap:ios       # sync, then open Xcode (macOS)
```

## Local native with the running API

The Vite proxy is what keeps `/api` and the `chat_session` cookie on one site
during development. Point the WebView at that server:

```bash
npm run dev
CAP_LIVE_RELOAD_URL=http://127.0.0.1:5173 npx cap run android
```

Use the LAN address of the machine, not `127.0.0.1`, if the device is physical.
Add that origin to `CHAT_WEB_ORIGINS` if the API is reached without the proxy.

## Packaged binary

A packaged WebView origin is `https://localhost` (Android) or
`capacitor://localhost` (iOS). Relative `/api` then hits the static bundle, not
the backend. Build with an absolute API origin:

```bash
VITE_API_BASE_URL=https://api.example npm run cap:sync
```

The API must allow that WebView origin (already in the default list) and must
be HTTPS. Login from a packaged app sets `SameSite=None; Secure` on the session
cookie so the native HTTP stack can store it. That is the same session model as
the browser, not a second token.

## Deep links

Scheme: `chat:`. Example: `chat://community/publications/<id>` opens
`/community/publications/<id>`. Possessing the URL is not a permission; the
API still decides whether the publication is visible.

HTTPS universal links and Play App Links are not configured here. Add the
association files and team/SHA fingerprints when a public web host exists.

The `chat` URL scheme is registered by hand in
`android/app/src/main/AndroidManifest.xml` and `ios/App/App/Info.plist`. Those
two edits are the only non-generated native changes in this phase.

## Share and export

Public Community links go through the system share sheet on a device, and
through Web Share or the clipboard in a browser. Create PNG export downloads in
a browser and, on a device, writes a cache file then opens the share sheet so
the person can put it in Photos, Files, or Messages.

## What this phase does not do

- A production API host, TLS certificates, or app-store signing
- Push notifications, camera, biometrics, or a second auth protocol
- Building or signing binaries in CI
