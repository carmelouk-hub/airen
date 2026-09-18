#!/bin/sh
set -eu

PID_FILE=/tmp/airenos-keycloak.pid
STOPPED_FILE=/tmp/airenos-keycloak-stopped

rm -f "$STOPPED_FILE"

/opt/keycloak/bin/kc.sh start --optimized &
child=$!
printf '%s\n' "$child" > "$PID_FILE"

term() {
  if kill -0 "$child" 2>/dev/null; then
    kill -TERM "$child" 2>/dev/null || true
    wait "$child" || true
  fi
  exit 0
}
trap term TERM INT

set +e
wait "$child"
status=$?
set -e
touch "$STOPPED_FILE"

# Temporary Gate110 recovery mode: keep container alive for Render SSH after
# Keycloak is intentionally stopped. Normal entrypoint is restored afterward.
while :; do
  sleep 3600 &
  wait $!
done
