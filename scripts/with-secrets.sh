#!/usr/bin/env bash
# Обгортка над командами, що ходять у базу: підтягує DB_* зі сховища
# (Infisical), щоб команди в package.json (migrate, seed, ...) не мали
# префіксів і не читали жоден новий env-файл самі (ДЗ №11 / ДЗ №13, п.7).
#
# Використання: scripts/with-secrets.sh <env-slug> <команда...>
#   npm-скрипти завжди передають dev як перший аргумент, напр.:
#     "migrate": "bash scripts/with-secrets.sh dev npx typeorm migration:run -d dist/data-source.js"
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ENV_SLUG="${1:-dev}"; shift || true

[ "$#" -gt 0 ] || set -- npm run start

# грейдер не має доступу до сховища: значення вже в оточенні
if [ "${SKIP_VAULT:-0}" = "1" ]; then exec "$@"; fi

CREDS="$ROOT/.secrets/infisical.env"

# Локальний кеш секретів (ДЗ №11): .secrets/infisical.env поза git,
# заповнюється одноразово через `infisical export --env="$ENV_SLUG" > ...`.
# Якщо кешу немає (свіжий клон, ще не робив export) — падаємо на живий
# виклик `infisical run`, який сам вимагає `infisical init`/логіна і саме
# тому на свіжому клоні без SKIP_VAULT=1 завершується
# "Please either run infisical init to connect to a project...", exit 1.
if [ -f "$CREDS" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$CREDS"
  set +a
  exec "$@"
fi

exec infisical run --env="$ENV_SLUG" -- "$@"
