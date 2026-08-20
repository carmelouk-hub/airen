#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/0001_foundation_runtime_core.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/0002_request_context_contract.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/postgres/bootstrap_roles.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/0003_foundation_rls.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/postgres/rls_runtime.sql
