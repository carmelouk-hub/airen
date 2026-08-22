#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/bootstrap/0000_runtime_roles.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/0001_foundation_runtime_core.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/0002_request_context_contract.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/0003_foundation_rls.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/0004_authentication_bootstrap.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/0005_runtime_role_grants.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/0006_r3a_tenant_provisioning.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/0007_r3a_tenant_lifecycle.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/0008_r3b_location_lifecycle.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/0009_r3c_tenant_domain_lifecycle.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/0010_r3d_platform_role_admin.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/0011_r3d_platform_role_admin_correction.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/0012_r3d_platform_role_identity_read_correction.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/postgres/rls_runtime.sql
