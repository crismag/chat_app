#!/usr/bin/env bash
#
# What this host can actually do. Run it on the remote before installing.
#
#   bash scripts-deploy/preflight.sh
#
# Reports rather than fixes, and exits non-zero only on the things that make a
# deployment impossible rather than merely awkward.
set -uo pipefail
cd "$(dirname "$0")"
source ./config.sh

fail=0
ok()   { printf '  ok    %s\n' "$1"; }
warn() { printf '  warn  %s\n' "$1"; }
bad()  { printf '  FAIL  %s\n' "$1"; fail=1; }

echo "== node =="
if command -v node >/dev/null 2>&1; then
  v="$(node --version)"; major="${v#v}"; major="${major%%.*}"
  [ "${major}" -ge 22 ] && ok "node ${v}" || bad "node ${v}; this needs 22 or newer"
  node --experimental-strip-types -e 'const x: number = 1; void x' 2>/dev/null \
    && ok "runs TypeScript directly, so no build step is needed here" \
    || bad "this node cannot strip types; the API will not start"
else
  bad "no node on PATH — a persistent Node process is required for the API"
fi

echo "== paths =="
[ -d "${DEPLOY_PUBLIC}" ] && ok "public_html ${DEPLOY_PUBLIC}" || bad "missing ${DEPLOY_PUBLIC}"
[ -f "${DEPLOY_ENV_FILE}" ] && ok ".env is present" || bad "missing ${DEPLOY_ENV_FILE}"
if [ -f "${DEPLOY_ENV_FILE}" ]; then
  perms="$(stat -c '%a' "${DEPLOY_ENV_FILE}" 2>/dev/null || echo '?')"
  case "${perms}" in
    600|400) ok ".env is ${perms}" ;;
    *) warn ".env is ${perms}; it holds three credentials, so 600 is the right mode" ;;
  esac
  for key in MYSQL_HOST MYSQL_USER MYSQL_PASSWORD MYSQL_DATABASE GEMINI_API_KEY YVP_APP_KEY; do
    grep -qE "^${key}=." "${DEPLOY_ENV_FILE}" && ok "${key} is set" || warn "${key} is not set"
  done
  # NODE_ENV is set by restart-api.sh and wins over the file, so its absence
  # here is correct rather than a finding. Its *presence* is the problem: a
  # non-production value in .env would be silently ignored, which is worse than
  # not working, so say so.
  if grep -qE "^NODE_ENV=" "${DEPLOY_ENV_FILE}"; then
    warn "NODE_ENV is set in .env; the deploy scripts set it to production and win, so this line does nothing"
  else
    ok "NODE_ENV comes from restart-api.sh, which sets production"
  fi
fi

echo "== the API route =="
if [ -n "$(command -v httpd 2>/dev/null || command -v apache2 2>/dev/null)" ]; then
  ok "an Apache-family server is present"
fi
warn "confirm ONE of these is true, because the browser has to reach /api:"
echo "        a) .htaccess may proxy — the RewriteRule [P] to 127.0.0.1:${DEPLOY_API_PORT} works, or"
echo "        b) hPanel runs the Node app and gives it a URL — then set"
echo "           VITE_API_BASE_URL to that URL and rebuild, and drop the proxy block."
echo "        After installing: curl -sS ${DEPLOY_URL}/api/health"

exit "${fail}"
