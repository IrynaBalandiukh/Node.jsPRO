#!/usr/bin/env bash
# Runs a command with DB_* environment variables prepared.
# Usage: scripts/with-secrets.sh <env-slug> <command...>
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ENV_SLUG="${1:-dev}"; shift || true

[ "$#" -gt 0 ] || set -- npm run start

# No vault access (grader, CI): the variables are already in the environment.
if [ "${SKIP_VAULT:-0}" = "1" ]; then exec "$@"; fi

# Local cache of the secrets (git-ignored), created with:
#   infisical export --env=dev > .secrets/infisical.env
CREDS="$ROOT/.secrets/infisical.env"
if [ -f "$CREDS" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$CREDS"
  set +a
  exec "$@"
fi

# Otherwise fetch the secrets from Infisical (needs `infisical login` + `init`).
exec infisical run --env="$ENV_SLUG" -- "$@"
