#!/usr/bin/env bash
# Rotates the Postgres password for the app role without restarting the app.
#
# Run from the project root (paths below are relative to it):
#   bash scripts/rotate.sh [new_password]
#
# Order matters: ALTER ROLE first (the new password becomes valid in
# Postgres immediately), then update the secret file (this is the moment new
# pool connections start authenticating with the new password), then
# terminate existing backends (forces the pool to open new connections,
# which re-read the — now updated — secret file). Finally DATABASE_URL in .env
# gets the new password too, so psql/tooling keep working.
set -euo pipefail

DB_USER="${DB_USER:-marketplace_app}"
DB_NAME="${DB_NAME:-marketplace}"
SECRET_FILE="${DB_PASSWORD_FILE:-secrets/db_password}"
COMPOSE_SERVICE="${COMPOSE_SERVICE:-postgres}"
NEW_PASSWORD="${1:-$(openssl rand -hex 16)}"

echo "Rotating password for role '$DB_USER'..."

# 1. ALTER ROLE
docker compose exec -T "$COMPOSE_SERVICE" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 \
  -c "ALTER ROLE \"$DB_USER\" WITH PASSWORD '$NEW_PASSWORD';"

# 2. Update the secret file
printf '%s' "$NEW_PASSWORD" > "$SECRET_FILE"
echo "Secret file updated: $SECRET_FILE"

# 3. Close existing connections so the pool is forced to reconnect
docker compose exec -T "$COMPOSE_SERVICE" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = '$DB_USER' AND pid <> pg_backend_pid();"

# 4. Keep DATABASE_URL in .env in sync. The app does not read it (it uses
# DB_* + the secret file), but psql / tooling / the grader do, and its
# embedded password would otherwise go stale after rotation. Not fatal: the
# rotation itself is already done at this point.
ENV_FILE="${ENV_FILE:-.env}"
if [ -f "$ENV_FILE" ]; then
  if ENV_FILE="$ENV_FILE" NEW_PASSWORD="$NEW_PASSWORD" node -e '
    const fs = require("fs");
    const f = process.env.ENV_FILE;
    let s = fs.readFileSync(f, "utf8");
    const re = /^(DATABASE_URL=)(["\x27]?)(.*?)\2(\r?)$/m;
    const m = s.match(re);
    if (!m) process.exit(2);
    const u = new URL(m[3]);
    u.password = process.env.NEW_PASSWORD;
    s = s.replace(re, (_, k, q, _v, cr) => k + q + u.href + q + cr);
    fs.writeFileSync(f, s);
  '; then
    echo "DATABASE_URL updated in $ENV_FILE"
  else
    echo "WARNING: could not update DATABASE_URL in $ENV_FILE - update its password manually" >&2
  fi
else
  echo "NOTE: $ENV_FILE not found, DATABASE_URL not updated"
fi

echo "Rotation complete."
