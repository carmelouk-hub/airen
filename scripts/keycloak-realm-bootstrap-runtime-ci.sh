#!/usr/bin/env bash
set -euo pipefail

IMAGE="${1:?usage: keycloak-realm-bootstrap-runtime-ci.sh <image>}"
REALM_FILE="deploy/keycloak/realm/airenos-realm.json"
DB_URL="jdbc:postgresql://127.0.0.1:5432/keycloak"
DB_USER="postgres"
DB_PASSWORD="postgres"
CONTAINER_NAME="airenos-keycloak-realm-ci-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
WORKDIR="$(mktemp -d)"
ADMIN_USER="ci-bootstrap-admin"
ADMIN_PASSWORD="$(openssl rand -hex 32)"

if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
  echo "::add-mask::${ADMIN_PASSWORD}"
fi

cleanup() {
  docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  rm -rf "${WORKDIR}"
}
trap cleanup EXIT

# Compatibility proof only: import into an ephemeral PostgreSQL database with no live provider side effects.
docker run --rm --network host \
  -v "${PWD}/${REALM_FILE}:/work/airenos-realm.json:ro" \
  -e KC_DB_URL="${DB_URL}" \
  -e KC_DB_USERNAME="${DB_USER}" \
  -e KC_DB_PASSWORD="${DB_PASSWORD}" \
  "${IMAGE}" import --optimized --file /work/airenos-realm.json --override false

docker run -d --name "${CONTAINER_NAME}" --network host \
  -e KC_DB_URL="${DB_URL}" \
  -e KC_DB_USERNAME="${DB_USER}" \
  -e KC_DB_PASSWORD="${DB_PASSWORD}" \
  -e KC_BOOTSTRAP_ADMIN_USERNAME="${ADMIN_USER}" \
  -e KC_BOOTSTRAP_ADMIN_PASSWORD="${ADMIN_PASSWORD}" \
  -e KC_HTTP_ENABLED=true \
  -e KC_HOSTNAME="http://127.0.0.1:8080" \
  "${IMAGE}" start --optimized >/dev/null

ready=false
for _ in $(seq 1 60); do
  if curl --fail --silent --show-error http://127.0.0.1:9000/health/ready >"${WORKDIR}/ready.json"; then
    ready=true
    break
  fi
  if ! docker inspect -f '{{.State.Running}}' "${CONTAINER_NAME}" 2>/dev/null | grep -qx true; then
    docker logs "${CONTAINER_NAME}" >&2 || true
    exit 1
  fi
  sleep 2
done

if [[ "${ready}" != true ]]; then
  docker logs "${CONTAINER_NAME}" >&2 || true
  echo "Keycloak readiness timeout" >&2
  exit 1
fi

curl --fail --silent --show-error \
  http://127.0.0.1:8080/realms/airenos/.well-known/openid-configuration \
  >"${WORKDIR}/discovery.json"

curl --fail --silent --show-error --request POST \
  http://127.0.0.1:8080/realms/master/protocol/openid-connect/token \
  --data-urlencode "client_id=admin-cli" \
  --data-urlencode "username=${ADMIN_USER}" \
  --data-urlencode "password=${ADMIN_PASSWORD}" \
  --data-urlencode "grant_type=password" \
  >"${WORKDIR}/token.json"

ACCESS_TOKEN="$(node -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!j.access_token) process.exit(2); process.stdout.write(j.access_token);' "${WORKDIR}/token.json")"

curl --fail --silent --show-error \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  "http://127.0.0.1:8080/admin/realms/airenos/clients?clientId=airenos-browser-session" \
  >"${WORKDIR}/client.json"

curl --fail --silent --show-error \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  "http://127.0.0.1:8080/admin/realms/airenos/users?max=1" \
  >"${WORKDIR}/users.json"

node - "${WORKDIR}/discovery.json" "${WORKDIR}/client.json" "${WORKDIR}/users.json" <<'NODE'
const assert = require("node:assert/strict");
const fs = require("node:fs");

const discovery = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const clients = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const users = JSON.parse(fs.readFileSync(process.argv[4], "utf8"));

assert.equal(discovery.issuer, "http://127.0.0.1:8080/realms/airenos");
assert.match(discovery.authorization_endpoint, /\/realms\/airenos\/protocol\/openid-connect\/auth$/);
assert.equal(clients.length, 1);

const client = clients[0];
assert.equal(client.clientId, "airenos-browser-session");
assert.equal(client.protocol, "openid-connect");
assert.equal(client.publicClient, true);
assert.equal(client.standardFlowEnabled, true);
assert.equal(client.implicitFlowEnabled, false);
assert.equal(client.directAccessGrantsEnabled, false);
assert.equal(client.serviceAccountsEnabled, false);
assert.equal(client.fullScopeAllowed, false);
assert.deepEqual(client.redirectUris, ["https://session.airenos.com/oidc/callback"]);
assert.deepEqual(client.webOrigins, []);
assert.equal(client.attributes?.["pkce.code.challenge.method"], "S256");
assert.deepEqual(users, []);

console.log("Keycloak realm bootstrap runtime compatibility PASS");
NODE
