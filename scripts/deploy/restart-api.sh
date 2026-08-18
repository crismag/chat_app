#!/usr/bin/env bash
#
# Stop the API if it is running, start it again from `current`.
#
# Deliberately a plain background process with a pid file rather than pm2 or
# systemd: neither is available on shared hosting, and adding a supervisor this
# does not need is a second thing to go wrong. If your host manages the Node
# app itself, restart it there instead and ignore this.
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/config.sh"

if [ -f "${DEPLOY_PID}" ] && kill -0 "$(cat "${DEPLOY_PID}")" 2>/dev/null; then
  echo "    stopping $(cat "${DEPLOY_PID}")"
  kill "$(cat "${DEPLOY_PID}")" 2>/dev/null || true
  for _ in $(seq 1 20); do
    kill -0 "$(cat "${DEPLOY_PID}")" 2>/dev/null || break
    sleep 0.5
  done
  kill -9 "$(cat "${DEPLOY_PID}")" 2>/dev/null || true
fi

mkdir -p "$(dirname "${DEPLOY_LOG}")"
cd "${DEPLOY_CURRENT}"

# These four are set here and NOT in .env, and that is a precedence decision:
# `node --env-file` does not overwrite a variable that is already set, so
# anything exported on this line wins over the file. .env supplies credentials
# and feature settings; the deploy scripts own where the app runs and where it
# writes. Setting PORT or DATABASE_PATH in .env will have no effect.
#
# The database file lives in private/data, not beside the code: a release
# directory is replaced on every deploy, and public_html is served to the world.
PORT="${DEPLOY_API_PORT}" \
DATABASE_PATH="${DEPLOY_DATA}/chat.sqlite" \
NODE_ENV=production \
CHAT_WEB_ORIGINS="${DEPLOY_URL}" \
nohup node --env-file="${DEPLOY_ENV_FILE}" --experimental-strip-types app.mjs \
  >> "${DEPLOY_LOG}" 2>&1 &

echo $! > "${DEPLOY_PID}"
echo "    started $(cat "${DEPLOY_PID}"), logging to ${DEPLOY_LOG}"
