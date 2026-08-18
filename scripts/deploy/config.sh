# The deployment target. Everything else reads these.
#
# Overridable from the environment so a second host (staging, a VPS) needs no
# edit here: DEPLOY_PRIVATE=... ./scripts/deploy/remote-install.sh
: "${DEPLOY_DOMAIN:=reflections.crishub.com}"
: "${DEPLOY_HOME:=/home/u471078694/domains/${DEPLOY_DOMAIN}}"
: "${DEPLOY_PRIVATE:=${DEPLOY_HOME}/private/chat_app}"
: "${DEPLOY_PUBLIC:=${DEPLOY_HOME}/public_html}"
: "${DEPLOY_URL:=https://${DEPLOY_DOMAIN}}"

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
