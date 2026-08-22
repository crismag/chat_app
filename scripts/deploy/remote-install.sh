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

echo "==> publishing the API gateway"
# chatapi.crishub.com's own document root. The gateway is what makes the Node
# process reachable at all on this plan — see README.
if [ -d "${DEPLOY_API_PUBLIC}" ]; then
  cp "${BUNDLE}/../chatapi/index.php" "${BUNDLE}/../chatapi/.htaccess" "${DEPLOY_API_PUBLIC}/"
else
  echo "    no ${DEPLOY_API_PUBLIC}; skipping (the API will not be reachable from a browser)"
fi

echo "==> restarting the API"
bash "${HERE}/restart-api.sh"

echo "==> verifying"
sleep 2

# Readiness, not liveness.
#
# A release that starts but cannot reach its database answers /api/health
# perfectly well — it is running, it is simply useless. Readiness opens the
# SQLite content and, when MYSQL_* is configured, MariaDB, so a deploy that
# cannot see its data fails here rather than in front of somebody trying to
# sign in.
if READY="$(curl -fsS -m 15 "http://127.0.0.1:${DEPLOY_API_PORT}/api/health/ready")"; then
  echo "    the API answers on the loopback, and can reach its stores"
  echo "      ${READY}"
else
  echo "    the API is not ready on 127.0.0.1:${DEPLOY_API_PORT} — see ${DEPLOY_LOG}"
  echo "    (a 503 here means it started but cannot reach a store; anything else"
  echo "     means it did not start)"
  exit 1
fi

# The routes a browser actually uses, checked rather than recommended.
#
# These were printed as homework for whoever ran the deploy, which meant they
# were the checks most often skipped — and they are the two that fail
# independently of the process being healthy: the API is reached on its own
# domain because mod_proxy is not permitted here, and a deep link depends on a
# rewrite in public_html.
#
# Not fatal. They depend on DNS, TLS and the host's application manager, none
# of which this script installs, and a release that is correct on disk should
# not be reported as a failed deploy because a restart is still pending
# elsewhere. Loud, though: a warning nobody reads is the same as no check.
PUBLIC_OK=1

if curl -fsS -m 15 "${DEPLOY_API_URL}/api/health/ready" >/dev/null; then
  echo "    ${DEPLOY_API_URL} answers"
else
  echo "    WARNING: ${DEPLOY_API_URL} did not answer."
  echo "             The API is fine on the loopback, so this is the route in front"
  echo "             of it: restart the app in hPanel, then try again."
  PUBLIC_OK=0
fi

DEEP_LINK_STATUS="$(curl -o /dev/null -s -m 15 -w '%{http_code}' "${DEPLOY_URL}/reflections" || echo 000)"
if [ "${DEEP_LINK_STATUS}" = "200" ]; then
  echo "    ${DEPLOY_URL}/reflections returns the app"
else
  echo "    WARNING: ${DEPLOY_URL}/reflections answered ${DEEP_LINK_STATUS}, not 200."
  echo "             A deep link must return index.html; check public_html/.htaccess."
  PUBLIC_OK=0
fi

echo
if [ "${PUBLIC_OK}" = "1" ]; then
  echo "Installed, and answering on the routes a browser uses."
else
  echo "Installed. The release is in place, but a route above did not answer —"
  echo "read the warnings before calling this deployed."
fi
echo
echo "Keeping the last five releases:"
ls -1dt "${DEPLOY_RELEASES}"/*/ 2>/dev/null | tail -n +6 | xargs -r rm -rf
ls -1dt "${DEPLOY_RELEASES}"/*/ 2>/dev/null | sed 's/^/  /'
