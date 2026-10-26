#!/usr/bin/env bash
# Course DB backup: pg_dump -Fc -> backups/<db>_<date>.dump (+ .checksum).
#   bash scripts/with-secrets.sh dev bash scripts/backup.sh
# Destination: a local folder outside the container (BACKUP_DIR, default
# ./backups, git-ignored). Run from the repo root; the schedule is backup.cron.
set -euo pipefail
# shellcheck source=scripts/lib-db.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib-db.sh"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y-%m-%d_%H-%M-%S)"
FILE="$BACKUP_DIR/${DB_NAME}_${STAMP}.dump"

# The checksum taken at backup time is stored next to the dump: the drill compares
# the restored data with it (the live DB may have changed since the backup).
SUM="$(checksum pg_in_service)"

# Write to .partial and rename only on success, so an interrupted dump never
# becomes the "latest" one for the drill.
pg_in_service pg_dump -Fc -U "$DB_USER" -d "$DB_NAME" > "$FILE.partial"
pg_in_service pg_restore --list < "$FILE.partial" > /dev/null   # is it a valid -Fc archive?
mv "$FILE.partial" "$FILE"
printf '%s\n' "$SUM" > "$FILE.checksum"

echo "Бекап створено: $FILE ($(wc -c < "$FILE") байт)"
echo "Контрольні значення (users|products|orders|order_items|sum(orders)): $SUM"
