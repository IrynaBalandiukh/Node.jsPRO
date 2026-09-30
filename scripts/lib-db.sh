#!/usr/bin/env bash
# Спільне для backup.sh / restore-drill.sh (ДЗ №15). Підключення беремо лише з
# $DATABASE_URL — його наповнює scripts/with-secrets.sh (ДЗ №11) або
# SKIP_VAULT=1 + export від грейдера. Жодного нового env-файла.
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

# Бекап бере pg_dump ПОВЗ PgBouncer — прямо з контейнера Postgres (host у
# DATABASE_URL — це пулер і порт із хоста, а pg_dump довга REPEATABLE READ
# транзакція з SET-ами, яку transaction mode не любить). Тому на хості не
# потрібні ні pg_dump, ні psql.
PG_SERVICE="${PG_SERVICE:-postgres}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"

pg_in_service() { docker compose exec -T -e PGPASSWORD="$DB_PASS" "$PG_SERVICE" "$@"; }

# Контрольні значення: кількість рядків по таблицях + агрегат по ключовій
# таблиці orders. Перший аргумент — команда, що виконує psql у потрібній БД.
checksum() {
  local has
  has="$("$@" psql -U "$DB_USER" -d "$DB_NAME" -At -c "SELECT to_regclass('public.orders') IS NOT NULL")"
  if [ "$has" != "t" ]; then echo "no-schema"; return; fi
  "$@" psql -U "$DB_USER" -d "$DB_NAME" -At -c "
    SELECT (SELECT count(*) FROM users)        || '|' ||
           (SELECT count(*) FROM products)     || '|' ||
           (SELECT count(*) FROM orders)       || '|' ||
           (SELECT count(*) FROM order_items)  || '|' ||
           (SELECT coalesce(sum(total_amount_cents), 0) FROM orders)"
}
