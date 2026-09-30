#!/usr/bin/env bash
# Restore-drill: останній дамп -> ЧИСТИЙ контейнер з порожнім новим volume ->
# порівняння контрольних значень -> MATCH (exit 0) або MISMATCH (exit 1).
#   bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh
# Контейнер і volume створюються на старті й знищуються на виході (також при
# помилці), тож повторний запуск завжди починає з нуля.
set -euo pipefail
# shellcheck source=scripts/lib-db.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib-db.sh"

DRILL_CONTAINER="${DRILL_CONTAINER:-marketplace-restore-drill}"
DRILL_VOLUME="${DRILL_VOLUME:-marketplace_restore_drill_pgdata}"
PG_IMAGE="${PG_IMAGE:-postgres:16-alpine}"

now_ms() {
  local t; t="$(date +%s%3N)"
  case "$t" in *N*) echo $(( $(date +%s) * 1000 )) ;; *) echo "$t" ;; esac   # BSD/macOS date без %N
}
cleanup() {
  docker rm -f -v "$DRILL_CONTAINER" > /dev/null 2>&1 || true
  docker volume rm -f "$DRILL_VOLUME" > /dev/null 2>&1 || true
}
trap cleanup EXIT

DUMP="$(ls -1 "$BACKUP_DIR/${DB_NAME}"_*.dump 2> /dev/null | sort | tail -n 1 || true)"
[ -n "$DUMP" ] || { echo "Немає жодного дампу в $BACKUP_DIR — спершу scripts/backup.sh" >&2; exit 1; }
[ -f "$DUMP.checksum" ] || { echo "Немає $DUMP.checksum" >&2; exit 1; }
EXPECTED="$(cat "$DUMP.checksum")"
SIZE="$(wc -c < "$DUMP")"

echo "Дамп:     $DUMP ($SIZE байт)"
echo "Очікуємо: $EXPECTED"

T0="$(now_ms)"
cleanup
docker volume create "$DRILL_VOLUME" > /dev/null
docker run -d --name "$DRILL_CONTAINER" \
  -e POSTGRES_USER="$DB_USER" -e POSTGRES_PASSWORD="$DB_PASS" -e POSTGRES_DB="$DB_NAME" \
  -v "$DRILL_VOLUME:/var/lib/postgresql/data" "$PG_IMAGE" > /dev/null

# -h 127.0.0.1: під час initdb тимчасовий сервер слухає лише unix-сокет,
# тож TCP-перевірка чекає на справжній сервер.
for _ in $(seq 1 60); do
  docker exec "$DRILL_CONTAINER" pg_isready -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" > /dev/null 2>&1 && break
  sleep 1
done
drill() { docker exec -i -e PGPASSWORD="$DB_PASS" "$DRILL_CONTAINER" "$@"; }
drill pg_isready -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" > /dev/null || { echo "Контейнер drill не піднявся" >&2; exit 1; }

PRE="$(drill psql -U "$DB_USER" -d "$DB_NAME" -At -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")"
[ "$PRE" = "0" ] || { echo "Drill-база не порожня ($PRE таблиць) — volume не чистий" >&2; exit 1; }

T1="$(now_ms)"
drill pg_restore --no-owner --exit-on-error -U "$DB_USER" -d "$DB_NAME" < "$DUMP"
T2="$(now_ms)"

ACTUAL="$(checksum drill)"
echo "Відновлено: $ACTUAL"
echo "Час відновлення (pg_restore): $(( T2 - T1 )) мс; RTO drill (старт контейнера -> перевірка): $(( $(now_ms) - T0 )) мс"

if [ "$ACTUAL" = "$EXPECTED" ]; then
  [ "$EXPECTED" != "no-schema" ] || echo "УВАГА: база порожня (немає схеми) — перед drill виконайте npm run migrate && npm run seed" >&2
  echo "MATCH"
else
  echo "MISMATCH: очікувалось '$EXPECTED', відновлено '$ACTUAL'" >&2
  exit 1
fi
