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
#   */15 * * * * PATH=/opt/alt/alt-nodejs22/root/usr/bin:/usr/local/bin:/usr/bin \
#     /home/u471078694/domains/.../current/scripts-deploy/keepalive.sh
#
# ── PATH is not optional ────────────────────────────────────────────────────
#
# `restart-api.sh` runs bare `node`, and cron's PATH is `/usr/local/bin:/usr/bin`
# — node lives under /opt/alt on this host and is not on it. Without the prefix
# this script correctly detects the outage and then fails to fix it.
#
# ── Two signals, and why both are recorded ──────────────────────────────────
#
# Whether the process EXISTS and whether it ANSWERS are different questions,
# and the pair tells you which failure you have:
#
#   alive=no  answering=no   the host reaped it — the case this exists for
#   alive=yes answering=no   it is running and wedged, OR this check cannot
#                            reach the loopback from wherever cron runs
#   alive=no  answering=yes  the pid file is stale; something else serves 8000
#
# The second row matters. If cron's environment could not reach 127.0.0.1, a
# health-check-only script would declare a perfectly good API dead and restart
# it on every tick, forever, and the log would not say why. Recording both
# makes that visible as a pattern instead of a mystery.
#
# The HTTP check remains the authority on whether to act: a process that exists
# but does not answer is no use to anybody, so a live pid is not a reason to
# leave a wedged API alone.
#
# ── The heartbeat ───────────────────────────────────────────────────────────
#
# A healthy run writes nothing to the log, which is right — a log that gets a
# line every 15 minutes is a log nobody reads. But it makes a working cron and
# a cron that was never installed look identical from the outside, which is
# exactly the doubt that follows an outage.
#
# So every run touches `keepalive.last`. One empty file, no growth, and
# `ls -l` on it answers "is the cron actually running?" in one command.
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=config.sh
. "${HERE}/config.sh"

WATCH_LOG="${DEPLOY_PRIVATE}/logs/keepalive.log"
STAMP="${DEPLOY_PRIVATE}/logs/keepalive.last"
mkdir -p "$(dirname "${WATCH_LOG}")"

# Proof of execution, before anything that could fail.
touch "${STAMP}"

alive=no
if [ -f "${DEPLOY_PID}" ] && kill -0 "$(cat "${DEPLOY_PID}" 2>/dev/null)" 2>/dev/null; then
  alive=yes
fi

if curl -fsS -o /dev/null --max-time 8 "http://127.0.0.1:${DEPLOY_API_PORT}/api/health"; then
  exit 0
fi

echo "$(date -Is) api not answering on ${DEPLOY_API_PORT} (process alive=${alive}); starting it" \
  >> "${WATCH_LOG}"
bash "${HERE}/restart-api.sh" >> "${WATCH_LOG}" 2>&1

# Wait for it, rather than asking once.
#
# `restart-api.sh` starts node in the background and returns immediately, and
# node takes a couple of seconds to read its config, check the schema and bind.
# A single check here answers before any of that has happened — and `--max-time`
# does not help, because a refused connection fails instantly rather than
# occupying the timeout. The old one-shot check therefore logged "still not
# answering after a restart" on every successful restart, which is worse than
# no line at all: a log that cries wolf is a log nobody trusts.
answering=no
for _ in $(seq 1 20); do
  if curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:${DEPLOY_API_PORT}/api/health"; then
    answering=yes
    break
  fi
  sleep 1
done

if [ "${answering}" = yes ]; then
  echo "$(date -Is) api answering again" >> "${WATCH_LOG}"
else
  echo "$(date -Is) api still not answering 20s after a restart" >> "${WATCH_LOG}"
fi
