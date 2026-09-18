#!/bin/sh
set -eu

PID_FILE=/tmp/airenos-keycloak.pid
STOPPED_FILE=/tmp/airenos-keycloak-stopped
HEALTH_PID_FILE=/tmp/airenos-recovery-health.pid

rm -f "$STOPPED_FILE" "$HEALTH_PID_FILE"

/opt/keycloak/bin/kc.sh start --optimized &
child=$!
printf '%s\n' "$child" > "$PID_FILE"

term() {
  if kill -0 "$child" 2>/dev/null; then
    kill -TERM "$child" 2>/dev/null || true
    wait "$child" || true
  fi
  if [ -f "$HEALTH_PID_FILE" ]; then
    hp="$(cat "$HEALTH_PID_FILE" 2>/dev/null || true)"
    if [ -n "$hp" ] && kill -0 "$hp" 2>/dev/null; then
      kill -TERM "$hp" 2>/dev/null || true
    fi
  fi
  exit 0
}
trap term TERM INT

set +e
wait "$child"
status=$?
set -e

/opt/keycloak/bin/airenos-recovery-health &
health_pid=$!
printf '%s\n' "$health_pid" > "$HEALTH_PID_FILE"
touch "$STOPPED_FILE"

while :; do
  sleep 3600 &
  wait $!
done
