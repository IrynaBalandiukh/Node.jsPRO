#!/usr/bin/env bash
# Rotates the Postgres password for the app role without restarting the app.
#
# Order matters: ALTER ROLE first (the new password becomes valid in
# Postgres immediately), then update the secret file (this is the moment new
# pool connections start authenticating with the new password), then
# terminate existing backends (forces the pool to open new connections,
# which re-read the — now updated — secret file).
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

echo "Rotation complete."
