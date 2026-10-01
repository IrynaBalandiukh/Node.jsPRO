#!/usr/bin/env bash
# Тонка обгортка над HTTP API Pact Broker (curl, без додаткових залежностей).
# Адреса і токен — лише з оточення (PACT_BROKER_URL / PACT_BROKER_TOKEN):
# локально їх підставляє scripts/with-secrets.sh, у CI — secrets GitHub.
# Дефолт URL — адреса локального compose, не секрет.
#
#   scripts/pact-broker.sh publish         # опублікувати pacts/*.json (версія консюмера)
#   scripts/pact-broker.sh tag-prod        # позначити версію ПРОВАЙДЕРА тегом prod
#   scripts/pact-broker.sh can-i-deploy    # гейт: exit 1, якщо deployable != true
#
# Версії: CONSUMER_VERSION (дефолт 1.0.0), PROVIDER_VERSION (дефолт 1.0.0).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BROKER="${PACT_BROKER_URL:-http://127.0.0.1:9292}"
BROKER="${BROKER%/}"
CONSUMER="marketplace-web"
PROVIDER="marketplace-api"
CONSUMER_VERSION="${CONSUMER_VERSION:-1.0.0}"
PROVIDER_VERSION="${PROVIDER_VERSION:-1.0.0}"
ENVIRONMENT="${DEPLOY_ENVIRONMENT:-prod}"

AUTH=()
if [ -n "${PACT_BROKER_TOKEN:-}" ]; then AUTH=(-H "Authorization: Bearer ${PACT_BROKER_TOKEN}"); fi

# curl з виводом тіла і HTTP-коду; повертає код у $CODE, тіло в $BODY.
call() {
  local out
  out="$(curl -sS "${AUTH[@]}" -w $'\n%{http_code}' "$@")"
  CODE="${out##*$'\n'}"
  BODY="${out%$'\n'*}"
}

case "${1:-}" in
  publish)
    FILE="$ROOT/pacts/${CONSUMER}-${PROVIDER}.json"
    [ -f "$FILE" ] || { echo "Немає $FILE — спершу npm run test:contract" >&2; exit 1; }
    call -X PUT "$BROKER/pacts/provider/$PROVIDER/consumer/$CONSUMER/version/$CONSUMER_VERSION" \
      -H 'Content-Type: application/json' --data-binary "@$FILE"
    echo "publish pact $CONSUMER@$CONSUMER_VERSION -> HTTP $CODE"
    case "$CODE" in 200|201) ;; *) echo "$BODY" >&2; exit 1;; esac
    ;;
  tag-prod)
    call -X PUT "$BROKER/pacticipants/$PROVIDER/versions/$PROVIDER_VERSION/tags/$ENVIRONMENT" \
      -H 'Content-Type: application/json'
    echo "tag $ENVIRONMENT on $PROVIDER@$PROVIDER_VERSION -> HTTP $CODE"
    case "$CODE" in 200|201) ;; *) echo "$BODY" >&2; exit 1;; esac
    ;;
  can-i-deploy)
    call -G "$BROKER/can-i-deploy" \
      --data-urlencode "pacticipant=$CONSUMER" \
      --data-urlencode "version=$CONSUMER_VERSION" \
      --data-urlencode "to=$ENVIRONMENT" \
      -H 'Accept: application/hal+json'
    echo "$BODY"
    # Гейт: проходимо ЛИШЕ на "deployable":true (unknown/false/помилка — стоп).
    if echo "$BODY" | tr -d ' \n' | grep -q '"deployable":true'; then
      echo "can-i-deploy: OK — $CONSUMER@$CONSUMER_VERSION можна викочувати в $ENVIRONMENT"
    else
      echo "can-i-deploy: ЗАБОРОНЕНО — deployable != true" >&2
      exit 1
    fi
    ;;
  *)
    echo "Usage: $0 {publish|tag-prod|can-i-deploy}" >&2
    exit 2
    ;;
esac
