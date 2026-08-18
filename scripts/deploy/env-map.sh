# Map the host's .env names onto the ones the application reads.
#
# The .env on reflections.crishub.com was written for a wider stack than this
# app — it also carries META_*, AWS_* and GOOGLE_PROJECT_* — and it names the
# database DB_* and YouVersion YOUVERSION_API_KEY. The application reads MYSQL_*
# and YVP_APP_KEY.
#
# Mapping here rather than renaming there, for two reasons: the file is the
# host's and something else may depend on those names, and a credentials file
# is a bad thing to rewrite from a deploy script. Nothing is overwritten — a
# name the application already understands always wins.
#
#   source env-map.sh <path-to-.env>
#
# Values are read with `.` rather than exported through a subshell so no
# credential is ever passed on a command line, where `ps` would show it.

_chat_env_map() {
  local file="${1:?env file}"
  [ -f "${file}" ] || return 0

  # Only KEY=VALUE lines, and the value is taken to the end of the line.
  local key value
  while IFS='=' read -r key value; do
    case "${key}" in ''|\#*) continue ;; esac
    # Strip one layer of surrounding quotes and any trailing CR. `node
    # --env-file` does this, so a mapping that did not would hand the driver a
    # database literally named "u471078694_reflections", quotes included —
    # which fails to connect for a reason that reads like bad credentials.
    value="${value%$'\r'}"
    case "${value}" in
      \"*\") value="${value#\"}"; value="${value%\"}" ;;
      \'*\') value="${value#\'}"; value="${value%\'}" ;;
    esac
    case "${key}" in
      DB_HOST)            [ -z "${MYSQL_HOST:-}" ]     && export MYSQL_HOST="${value}" ;;
      DB_USER)            [ -z "${MYSQL_USER:-}" ]     && export MYSQL_USER="${value}" ;;
      DB_PASSWORD)        [ -z "${MYSQL_PASSWORD:-}" ] && export MYSQL_PASSWORD="${value}" ;;
      DB_NAME)            [ -z "${MYSQL_DATABASE:-}" ] && export MYSQL_DATABASE="${value}" ;;
      DB_PORT)            [ -z "${MYSQL_PORT:-}" ]     && export MYSQL_PORT="${value}" ;;
      YOUVERSION_API_KEY) [ -z "${YVP_APP_KEY:-}" ]    && export YVP_APP_KEY="${value}" ;;
    esac
  done < "${file}"

  # A key is not consent. Assistance sends someone's private reflection to a
  # third party, so it stays off until it is switched on deliberately — the
  # presence of GEMINI_API_KEY in a file is not that decision.
  return 0
}

_chat_env_map "${1:-${DEPLOY_ENV_FILE:-}}"
