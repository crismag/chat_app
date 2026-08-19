# The deployment target. Everything else reads these.
#
# Overridable from the environment so a second host (staging, a VPS) needs no
# edit here: DEPLOY_PRIVATE=... ./scripts/deploy/remote-install.sh
: "${DEPLOY_DOMAIN:=reflections.crishub.com}"
: "${DEPLOY_HOME:=/home/u471078694/domains/${DEPLOY_DOMAIN}}"
: "${DEPLOY_PRIVATE:=${DEPLOY_HOME}/private/chat_app}"
: "${DEPLOY_PUBLIC:=${DEPLOY_HOME}/public_html}"
: "${DEPLOY_URL:=https://${DEPLOY_DOMAIN}}"

# The API answers on its own domain, with its own document root.
#
# It is a separate domain rather than a path on the site because mod_proxy is
# not permitted here, so /api cannot be handed to a local process — and a
# subdomain of reflections.crishub.com could only be rooted INSIDE that site's
# public_html, which made every file the API served also readable from the
# site. chatapi.crishub.com has its own root and no overlap.
#
# Still the same registrable domain as the site, which is what keeps the
# session cookie working: different origin, same site.
: "${DEPLOY_API_DOMAIN:=chatapi.crishub.com}"
: "${DEPLOY_API_URL:=https://${DEPLOY_API_DOMAIN}}"
: "${DEPLOY_API_PUBLIC:=${DEPLOY_HOME%/*}/${DEPLOY_API_DOMAIN}/public_html}"

# The API listens here, on the loopback only. The public URL reaches it through
# the rewrite in public_html/.htaccess, so this port is never exposed directly.
: "${DEPLOY_API_PORT:=8000}"

# Kept out of public_html on purpose: everything under it is served to anyone
# who asks. The database, the .env and the logs are all readable files.
: "${DEPLOY_DATA:=${DEPLOY_PRIVATE}/data}"
: "${DEPLOY_RELEASES:=${DEPLOY_PRIVATE}/releases}"
: "${DEPLOY_CURRENT:=${DEPLOY_PRIVATE}/current}"
: "${DEPLOY_ENV_FILE:=${DEPLOY_PRIVATE}/.env}"
: "${DEPLOY_LOG:=${DEPLOY_PRIVATE}/logs/api.log}"
: "${DEPLOY_PID:=${DEPLOY_PRIVATE}/api.pid}"
