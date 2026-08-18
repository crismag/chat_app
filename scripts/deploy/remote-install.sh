#!/usr/bin/env bash
#
# Install a release on the remote. Run it there, from the unpacked bundle:
#
#   tar -xzf chat_app-<sha>.tar.gz
#   bash app/scripts-deploy/remote-install.sh
#
# Releases are kept side by side and `current` is a symlink, so going back is
# repointing a link rather than restoring a backup.
#
# It never writes .env, and it never touches data/. Those are yours.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
BUNDLE="$(cd "${HERE}/.." && pwd)"          # .../app
STAGED_PUBLIC="$(cd "${BUNDLE}/../public_html" && pwd)"
source "${HERE}/config.sh"

RELEASE="$(head -1 "${BUNDLE}/RELEASE" 2>/dev/null || date -u +%Y%m%d%H%M%S)"
TARGET="${DEPLOY_RELEASES}/${RELEASE}"

echo "==> release ${RELEASE}"
[ -f "${DEPLOY_ENV_FILE}" ] || { echo "no .env at ${DEPLOY_ENV_FILE}; refusing"; exit 1; }

mkdir -p "${DEPLOY_RELEASES}" "${DEPLOY_DATA}" "$(dirname "${DEPLOY_LOG}")"

echo "==> copying the application"
rm -rf "${TARGET}"
mkdir -p "${TARGET}"
cp -r "${BUNDLE}/." "${TARGET}/"

echo "==> installing production dependencies"
# --omit=dev on purpose: the remote runs the TypeScript directly, so tsx,
# vitest, typescript and oxlint have no business being here. argon2 resolves a
# prebuilt binary for linux-x64, so nothing compiles.
( cd "${TARGET}" && npm ci --omit=dev --no-audit --fund=false )

echo "==> applying database migrations"
# The host's .env names the database DB_*; the application reads MYSQL_*.
# See env-map.sh — nothing is renamed on disk.
( set +u; . "${HERE}/env-map.sh" "${DEPLOY_ENV_FILE}"; set -u
  cd "${TARGET}/api" && node --env-file="${DEPLOY_ENV_FILE}" --experimental-strip-types src/mysql/cli.ts )

echo "==> pointing current at it"
ln -sfn "${TARGET}" "${DEPLOY_CURRENT}"

echo "==> publishing the web app"
# index.html and the hashed assets replace what is there; anything the host put
# in public_html that we did not ship is left alone.
cp -r "${STAGED_PUBLIC}/." "${DEPLOY_PUBLIC}/"

echo "==> restarting the API"
bash "${HERE}/restart-api.sh"

echo "==> verifying"
sleep 2
if curl -fsS "http://127.0.0.1:${DEPLOY_API_PORT}/api/health" >/dev/null; then
  echo "    the API answers on the loopback"
else
  echo "    the API did NOT answer on 127.0.0.1:${DEPLOY_API_PORT} — see ${DEPLOY_LOG}"
  exit 1
fi
echo
echo "Installed. Now check the two things this script cannot:"
echo "  curl -sS ${DEPLOY_URL}/api/health     # the browser's route to the API"
echo "  curl -sSI ${DEPLOY_URL}/reflections   # a deep link must return the app, not a 404"
echo
echo "Keeping the last five releases:"
ls -1dt "${DEPLOY_RELEASES}"/*/ 2>/dev/null | tail -n +6 | xargs -r rm -rf
ls -1dt "${DEPLOY_RELEASES}"/*/ 2>/dev/null | sed 's/^/  /'
