#!/usr/bin/env bash
#
# Start the API if it is not answering.
#
# The API is a long-running Node process on shared hosting, started over SSH.
# The host reaps such processes — not predictably, and without a message: the
# log ends with "listening" and the next line is the next start. When it is
# gone the PHP gateway answers 502, and the browser shows "Failed to fetch",
# which is indistinguishable from a wrong password to the person typing one.
#
# The proper arrangement is hPanel's own Node application, which the host keeps
# alive and restarts itself; that has to be created once in the panel and is
# documented in README.md. Until it is, this is the safety net: a cron job that
# asks the API whether it is there and starts it if it is not.
#
# Deliberately dumb. It does not restart a process that is answering, it does
# not try to diagnose anything, and it writes one line when it acts so that a
# pattern of restarts is visible rather than silent.
#
#   * * * * * /home/u471078694/domains/reflections.crishub.com/private/chat_app/current/scripts-deploy/keepalive.sh
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=config.sh
. "${HERE}/config.sh"

WATCH_LOG="${DEPLOY_PRIVATE}/logs/keepalive.log"
mkdir -p "$(dirname "${WATCH_LOG}")"

if curl -fsS -o /dev/null --max-time 8 "http://127.0.0.1:${DEPLOY_API_PORT}/api/health"; then
  exit 0
fi

echo "$(date -Is) api not answering on ${DEPLOY_API_PORT}; starting it" >> "${WATCH_LOG}"
bash "${HERE}/restart-api.sh" >> "${WATCH_LOG}" 2>&1

if curl -fsS -o /dev/null --max-time 10 "http://127.0.0.1:${DEPLOY_API_PORT}/api/health"; then
  echo "$(date -Is) api answering again" >> "${WATCH_LOG}"
else
  echo "$(date -Is) api still not answering after a restart" >> "${WATCH_LOG}"
fi
