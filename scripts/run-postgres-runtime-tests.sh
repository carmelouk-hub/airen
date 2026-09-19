#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

export MIGRATION_SECRET_MANAGER_ADAPTER=env
export MIGRATION_DATABASE_URL_SECRET_REF=secret://env/DATABASE_URL
export AIREN_RUNTIME_ROLE_PROVISIONING_MODE=bootstrap

echo "FOUNDATION_MIGRATION_RUNNER=START"
timeout 90s node --experimental-strip-types deploy/migrate.ts
echo "FOUNDATION_MIGRATION_RUNNER=PASS"

echo "FOUNDATION_RLS_RUNTIME=START"
PGOPTIONS="-c statement_timeout=90000 -c lock_timeout=15000" \
  timeout 100s psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/postgres/rls_runtime.sql
echo "FOUNDATION_RLS_RUNTIME=PASS"
