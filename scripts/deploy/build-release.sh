#!/usr/bin/env bash
#
# Build a release tarball, on a machine that has the dev dependencies.
#
# The remote never builds. It has no dev dependencies and no reason to compile
# anything: the web app ships as the static files Vite produced, and the API
# ships as its own TypeScript, which Node runs directly (see remote-install.sh).
#
#   ./scripts/deploy/build-release.sh          -> dist/chat_app-<sha>.tar.gz
#
set -euo pipefail
cd "$(dirname "$0")/../.."
source scripts/deploy/config.sh

SHA="$(git rev-parse --short HEAD)"
DIRTY=""
[ -n "$(git status --porcelain)" ] && DIRTY="-dirty"
STAMP="${SHA}${DIRTY}"
OUT="dist/chat_app-${STAMP}.tar.gz"
STAGE="$(mktemp -d)"
trap 'rm -rf "${STAGE}"' EXIT

echo "==> building the web app"
# Where the browser sends API calls. Baked in at build time, because Vite
# replaces import.meta.env at compile time — changing it needs a rebuild, not a
# restart.
#
# The default is the API's own domain rather than a same-origin /api, because
# mod_proxy is not permitted on this host and a rewrite to a local port answers
# 503. The path keeps its /api prefix: the routes are defined as /api/... and
# nothing strips it.
: "${VITE_API_BASE_URL:=${DEPLOY_API_URL}/api}"
echo "    API base: ${VITE_API_BASE_URL}"
VITE_API_BASE_URL="${VITE_API_BASE_URL}" npm run build -w web_app >/dev/null

echo "==> checking the API runs without dev dependencies"
# The one assumption worth failing early on. `start` used to need tsx, which is
# a dev dependency and would not be installed on the remote.
node --experimental-strip-types --check api/src/index.ts

echo "==> assembling"
mkdir -p "${STAGE}/app" "${STAGE}/public_html"

# The API and everything it imports at runtime.
cp -r api "${STAGE}/app/api"
rm -rf "${STAGE}/app/api/node_modules" "${STAGE}/app/api/chat.sqlite"*
find "${STAGE}/app/api" -name '*.test.ts' -delete
cp -r packages "${STAGE}/app/packages"
rm -rf "${STAGE}/app/packages"/*/node_modules
find "${STAGE}/app/packages" -name '*.test.ts' -delete

# Workspace manifests, so `npm ci --omit=dev` resolves @chat/shared by link.
cp package.json package-lock.json .nvmrc "${STAGE}/app/"

# The lockfile pins Create Studio to a file: tarball in vendor/. It is a web
# dependency and the web app ships built, but `npm ci` still resolves every
# entry in the lockfile and fails on a path that is not there.
cp -r vendor "${STAGE}/app/vendor"
cp scripts/deploy/app.mjs "${STAGE}/app/app.mjs"
cp -r scripts/deploy "${STAGE}/app/scripts-deploy"

# The web app, exactly as it will be served.
cp -r web_app/dist/. "${STAGE}/public_html/"
cp scripts/deploy/public_html.htaccess "${STAGE}/public_html/.htaccess"

# The web workspace is in package.json's `workspaces`, so `npm ci` would want
# its manifest. It ships built, so give npm the manifest and nothing else.
mkdir -p "${STAGE}/app/web_app"
node -e '
  const p = require("./web_app/package.json");
  delete p.dependencies; delete p.devDependencies; delete p.scripts;
  require("fs").writeFileSync(process.argv[1], JSON.stringify(p, null, 2) + "\n");
' "${STAGE}/app/web_app/package.json"

echo "${STAMP}" > "${STAGE}/app/RELEASE"
date -u +"%Y-%m-%dT%H:%M:%SZ" >> "${STAGE}/app/RELEASE"

mkdir -p dist
tar -czf "${OUT}" -C "${STAGE}" app public_html
echo "==> ${OUT}"
[ -n "${DIRTY}" ] && echo "    NOTE: built from a dirty tree" || true
