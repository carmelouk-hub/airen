#!/usr/bin/env bash
set -euo pipefail

: "${IMAGE_TAG:?IMAGE_TAG is required}"
: "${MIGRATION_DATABASE_URL:?MIGRATION_DATABASE_URL is required}"
: "${RELEASE_REVISION:?RELEASE_REVISION is required}"

GOOD_NAME="airen-deploy-good"
BAD_NAME="airen-deploy-bad"
ROLLBACK_NAME="airen-deploy-rollback"
GOOD_PORT="38080"
BAD_PORT="38081"
ROLLBACK_PORT="38082"
RUNTIME_DB_PASSWORD="$(openssl rand -hex 24)"
AUTH_KEY="$(openssl rand -hex 32)"
RUNTIME_DB_URL="postgresql://airen_runtime_ci:${RUNTIME_DB_PASSWORD}@127.0.0.1:5432/airen_test"
BAD_DB_URL="postgresql://airen_runtime_ci:${RUNTIME_DB_PASSWORD}@127.0.0.1:59999/airen_test"
MIGRATION_REF="secret://env/AIREN_MIGRATION_DATABASE_URL"
RUNTIME_DB_REF="secret://env/AIREN_RUNTIME_DATABASE_URL"
AUTH_REF="secret://env/AIREN_RUNTIME_AUTH_KEY"
WORKDIR="${RUNNER_TEMP:-/tmp}/airen-deployment-evidence"
mkdir -p "$WORKDIR"

if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
  echo "::add-mask::$RUNTIME_DB_PASSWORD"
  echo "::add-mask::$AUTH_KEY"
  echo "::add-mask::$RUNTIME_DB_URL"
fi

cleanup() {
  docker rm -f "$GOOD_NAME" "$BAD_NAME" "$ROLLBACK_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

run_migrations() {
  docker run --rm --network host \
    -e MIGRATION_SECRET_MANAGER_ADAPTER=env \
    -e MIGRATION_DATABASE_URL_SECRET_REF="$MIGRATION_REF" \
    -e AIREN_MIGRATION_DATABASE_URL="$MIGRATION_DATABASE_URL" \
    "$IMAGE_TAG" node --experimental-strip-types deploy/migrate.ts
}

run_migrations | tee "$WORKDIR/migration-first.log"
run_migrations | tee "$WORKDIR/migration-second.log"
SKIP_COUNT="$(grep -c '"event":"migration.skip"' "$WORKDIR/migration-second.log" || true)"
if [[ "$SKIP_COUNT" -lt 5 ]]; then
  echo "Expected all Foundation migrations to be checksum-verified no-ops on second deployment" >&2
  exit 1
fi

docker run --rm --network host \
  -v "$PWD/tests/deployment:/work:ro" \
  postgres:16 \
  psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -v runtime_password="$RUNTIME_DB_PASSWORD" -f /work/provision_runtime_login.sql >/dev/null

run_api() {
  local name="$1"
  local port="$2"
  local revision="$3"
  local database_url="$4"
  docker run -d --name "$name" --network host \
    -e NODE_ENV=production \
    -e APP_BASE_DOMAIN=ristoairen.test \
    -e AUTH_ADAPTER=signed-session \
    -e AUTH_PROVIDER_KEY=synthetic-auth \
    -e AUTH_AUDIENCE=airenos-foundation \
    -e SECRET_MANAGER_ADAPTER=env \
    -e DATABASE_URL_SECRET_REF="$RUNTIME_DB_REF" \
    -e AUTH_SESSION_KEY_SECRET_REF="$AUTH_REF" \
    -e AIREN_RUNTIME_DATABASE_URL="$database_url" \
    -e AIREN_RUNTIME_AUTH_KEY="$AUTH_KEY" \
    -e OBJECT_STORAGE_ADAPTER=s3-compatible \
    -e REALTIME_ADAPTER=provider-neutral \
    -e HOST=0.0.0.0 \
    -e PORT="$port" \
    -e RELEASE_REVISION="$revision" \
    "$IMAGE_TAG" >/dev/null
}

wait_live() {
  local port="$1"
  for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${port}/health/live" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

wait_ready() {
  local port="$1"
  local output="$2"
  for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${port}/health/ready" -o "$output" 2>/dev/null; then return 0; fi
    sleep 1
  done
  return 1
}

IMAGE_ID="$(docker image inspect "$IMAGE_TAG" --format '{{.Id}}')"
RUNTIME_UID="$(docker run --rm "$IMAGE_TAG" id -u)"
if [[ "$RUNTIME_UID" == "0" ]]; then
  echo "Runtime image must not run as root" >&2
  exit 1
fi

set +e
docker run --rm --network host \
  -e NODE_ENV=production \
  -e APP_BASE_DOMAIN=ristoairen.test \
  -e AUTH_ADAPTER=signed-session \
  -e AUTH_PROVIDER_KEY=synthetic-auth \
  -e AUTH_AUDIENCE=airenos-foundation \
  -e SECRET_MANAGER_ADAPTER=env \
  -e DATABASE_URL_SECRET_REF="$RUNTIME_DB_REF" \
  -e AIREN_RUNTIME_DATABASE_URL="$RUNTIME_DB_URL" \
  -e RELEASE_REVISION="$RELEASE_REVISION" \
  "$IMAGE_TAG" >"$WORKDIR/fail-closed.log" 2>&1
FAIL_CLOSED_EXIT="$?"
set -e
if [[ "$FAIL_CLOSED_EXIT" -eq 0 ]]; then
  echo "Runtime must fail closed when required auth secret reference is missing" >&2
  exit 1
fi

run_api "$GOOD_NAME" "$GOOD_PORT" "$RELEASE_REVISION" "$RUNTIME_DB_URL"
wait_live "$GOOD_PORT"
wait_ready "$GOOD_PORT" "$WORKDIR/good-ready.json"
node -e 'const fs=require("fs");const x=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(x.status!=="READY"||x.releaseRevision!==process.argv[2])process.exit(1)' "$WORKDIR/good-ready.json" "$RELEASE_REVISION"

curl -fsS -D "$WORKDIR/trace.headers" -o /dev/null \
  -H 'x-correlation-id: deployment-check-12345678' \
  -H 'traceparent: 00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01' \
  "http://127.0.0.1:${GOOD_PORT}/health/live"
grep -qi '^x-correlation-id: deployment-check-12345678' "$WORKDIR/trace.headers"
grep -Eqi '^traceparent: 00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-[0-9a-f]{16}-01' "$WORKDIR/trace.headers"

docker logs "$GOOD_NAME" >"$WORKDIR/good.log" 2>&1 || true
docker stop --time 10 "$GOOD_NAME" >/dev/null

after_good_image="$(docker inspect "$GOOD_NAME" --format '{{.Image}}' 2>/dev/null || true)"
docker rm "$GOOD_NAME" >/dev/null

run_api "$BAD_NAME" "$BAD_PORT" "${RELEASE_REVISION}-candidate" "$BAD_DB_URL"
wait_live "$BAD_PORT"
for _ in $(seq 1 20); do
  HTTP_CODE="$(curl -sS -o "$WORKDIR/bad-ready.json" -w '%{http_code}' "http://127.0.0.1:${BAD_PORT}/health/ready" || true)"
  if [[ "$HTTP_CODE" == "503" ]]; then break; fi
  sleep 1
done
if [[ "${HTTP_CODE:-}" != "503" ]]; then
  echo "Readiness must detect the degraded deployment candidate" >&2
  exit 1
fi
node -e 'const fs=require("fs");const x=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(x.status!=="NOT_READY")process.exit(1)' "$WORKDIR/bad-ready.json"
docker logs "$BAD_NAME" >"$WORKDIR/bad.log" 2>&1 || true
docker stop --time 10 "$BAD_NAME" >/dev/null
docker rm "$BAD_NAME" >/dev/null

run_api "$ROLLBACK_NAME" "$ROLLBACK_PORT" "$RELEASE_REVISION" "$RUNTIME_DB_URL"
wait_live "$ROLLBACK_PORT"
wait_ready "$ROLLBACK_PORT" "$WORKDIR/rollback-ready.json"
node -e 'const fs=require("fs");const x=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(x.status!=="READY"||x.releaseRevision!==process.argv[2])process.exit(1)' "$WORKDIR/rollback-ready.json" "$RELEASE_REVISION"
ROLLBACK_IMAGE="$(docker inspect "$ROLLBACK_NAME" --format '{{.Image}}')"
docker logs "$ROLLBACK_NAME" >"$WORKDIR/rollback.log" 2>&1 || true
docker stop --time 10 "$ROLLBACK_NAME" >/dev/null
docker rm "$ROLLBACK_NAME" >/dev/null

if [[ "$ROLLBACK_IMAGE" != "$IMAGE_ID" ]]; then
  echo "Rollback must restore the exact known-good immutable image" >&2
  exit 1
fi
if [[ -n "$after_good_image" && "$after_good_image" != "$IMAGE_ID" ]]; then
  echo "Initial deployment image identity changed unexpectedly" >&2
  exit 1
fi

for log in "$WORKDIR"/*.log "$WORKDIR"/*.json; do
  if grep -Fq "$AUTH_KEY" "$log" || grep -Fq "$RUNTIME_DB_PASSWORD" "$log"; then
    echo "Secret material leaked into deployment evidence" >&2
    exit 1
  fi
done

cat > "$WORKDIR/B44-FX-014_Deployment_Runtime_Evidence.json" <<EOF
{
  "pack": "B44-FX-014",
  "status": "RUNTIME_DEPLOYMENT_PATH_PASS",
  "release_revision": "$RELEASE_REVISION",
  "image_id": "$IMAGE_ID",
  "runtime_uid": "$RUNTIME_UID",
  "migration_first_run": "PASS",
  "migration_idempotent_second_run": "PASS",
  "startup_fail_closed": "PASS",
  "liveness": "PASS",
  "readiness": "PASS",
  "w3c_trace_propagation": "PASS",
  "least_privilege_runtime_role": "PASS",
  "degraded_candidate_detected": "PASS",
  "rollback_to_known_good_image": "PASS",
  "secret_material_absent_from_evidence": "PASS"
}
EOF

printf '%s\n' "$WORKDIR/B44-FX-014_Deployment_Runtime_Evidence.json"
