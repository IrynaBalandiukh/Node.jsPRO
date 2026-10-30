#!/usr/bin/env bash
# Thin wrapper over the Pact Broker HTTP API (curl, no extra dependencies).
# URL and token come only from the environment (PACT_BROKER_URL / PACT_BROKER_TOKEN):
# locally scripts/with-secrets.sh supplies them, in CI GitHub secrets.
# The default URL is the local compose address, not a secret.
#
#   scripts/pact-broker.sh publish         # publish pacts/*.json (consumer version)
#   scripts/pact-broker.sh tag-prod        # tag the PROVIDER version as prod
#   scripts/pact-broker.sh can-i-deploy    # gate: exit 1 unless deployable == true
#
# Versions: CONSUMER_VERSION (default 1.0.0), PROVIDER_VERSION (default 1.0.0).
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

# curl that prints the body and the HTTP code; returns the code in $CODE, the body in $BODY.
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
    # Gate: pass ONLY on "deployable":true (unknown/false/error — stop).
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
