#!/usr/bin/env bash
# Shared by backup.sh / restore-drill.sh (HW 15). The connection comes only from
# $DATABASE_URL, filled by scripts/with-secrets.sh (HW 11) or by SKIP_VAULT=1 plus
# an export from the grader. No new env file.
# shellcheck shell=bash

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

: "${DATABASE_URL:?DATABASE_URL не задано — запускайте через 'bash scripts/with-secrets.sh dev bash $0' (або SKIP_VAULT=1 + export DATABASE_URL=...)}"

URL_RE='^postgres(ql)?://([^:/@]+):([^@]*)@([^:/]+)(:([0-9]+))?/([^?]+)'
if [[ ! "$DATABASE_URL" =~ $URL_RE ]]; then
  echo "DATABASE_URL має вигляд postgres://user:pass@host:port/db" >&2
  exit 2
fi
DB_USER="${BASH_REMATCH[2]}"
DB_PASS="${BASH_REMATCH[3]}"
DB_NAME="${BASH_REMATCH[7]}"

# pg_dump runs BYPASSING PgBouncer, inside the Postgres container: the host in
# DATABASE_URL is the pooler, and pg_dump is one long REPEATABLE READ transaction
# with SETs, which transaction mode handles badly. So the host needs neither
# pg_dump nor psql.
PG_SERVICE="${PG_SERVICE:-postgres}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"

pg_in_service() { docker compose exec -T -e PGPASSWORD="$DB_PASS" "$PG_SERVICE" "$@"; }

# Checksum: row counts per table + an aggregate over the key table orders.
# The arguments are the command prefix that runs psql in the target database.
checksum() {
  local has
  has="$("$@" psql -U "$DB_USER" -d "$DB_NAME" -At -c "SELECT to_regclass('public.orders') IS NOT NULL")"
  if [ "$has" != "t" ]; then echo "no-schema"; return; fi
  "$@" psql -U "$DB_USER" -d "$DB_NAME" -At -c "
    SELECT (SELECT count(*) FROM users)        || '|' ||
           (SELECT count(*) FROM products)     || '|' ||
           (SELECT count(*) FROM orders)       || '|' ||
           (SELECT count(*) FROM order_items)  || '|' ||
           (SELECT coalesce(sum(total_cents), 0) FROM orders)"
}
