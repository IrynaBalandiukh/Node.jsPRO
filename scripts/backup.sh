#!/usr/bin/env bash
# Бекап бази курсового: pg_dump -Fc -> backups/<db>_<дата>.dump (+ .checksum).
#   bash scripts/with-secrets.sh dev bash scripts/backup.sh
# Destination — локальна тека поза контейнером (BACKUP_DIR, за замовчуванням
# ./backups, у .gitignore). Запускається з кореня репо; розклад — backup.cron.
set -euo pipefail
# shellcheck source=scripts/lib-db.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib-db.sh"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y-%m-%d_%H-%M-%S)"
FILE="$BACKUP_DIR/${DB_NAME}_${STAMP}.dump"

# Контрольні значення на момент бекапу лежать поруч із дампом: drill порівнює
# відновлене саме з ними (живу БД після бекапу вже могли змінити).
SUM="$(checksum pg_in_service)"

# Пишемо в .partial і перейменовуємо лише після успіху — обірваний дамп
# ніколи не стане "останнім" для drill.
pg_in_service pg_dump -Fc -U "$DB_USER" -d "$DB_NAME" > "$FILE.partial"
pg_in_service pg_restore --list < "$FILE.partial" > /dev/null   # валідний -Fc архів?
mv "$FILE.partial" "$FILE"
printf '%s\n' "$SUM" > "$FILE.checksum"

echo "Бекап створено: $FILE ($(wc -c < "$FILE") байт)"
echo "Контрольні значення (users|products|orders|order_items|sum(orders)): $SUM"
