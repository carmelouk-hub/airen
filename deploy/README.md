# AIRenOS Foundation deployment contract

B44-FX-014 defines a provider-neutral deployment path for the Foundation runtime. The deployable unit is an OCI image built from `deploy/Dockerfile`; no hosting vendor is part of the Foundation contract.

## Runtime contract

The API starts only after typed runtime configuration and SecretRef resolution succeed. The reference image composition currently registers the `env` SecretProvider solely for synthetic/reference deployment verification. Production secret-manager selection remains behind the existing `SecretProvider` interface.

The container runs as the non-root `node` user, exposes `/health/live` and `/health/ready`, emits structured redacted telemetry to stdout, and handles SIGTERM/SIGINT with bounded graceful shutdown.

`/health/ready` verifies PostgreSQL connectivity and rejects a runtime database principal that is superuser, BYPASSRLS, or not a member of both `airen_app` and `airen_auth` group roles.

## Database deployment contract

Database role bootstrap is source-controlled in `db/bootstrap/0000_runtime_roles.sql`. It creates NOLOGIN group roles only; login principals and credential material remain an operator/deployment responsibility.

`deploy/migrate.ts` is a one-shot migration command. It resolves the migration database credential through a SecretRef, takes a PostgreSQL advisory lock, validates migration checksums, executes each transaction-wrapped migration atomically with its migration-ledger record, and treats a changed checksum for an already-applied migration as a conflict.

The second execution of the same release must be a checksum-verified no-op.

## CI deployment evidence

`scripts/verify-deployment-runtime.sh` performs the synthetic runtime rehearsal used by GitHub Actions:

1. build the OCI image from the exact Git commit;
2. execute migrations and prove second-run idempotency;
3. provision a synthetic least-privilege LOGIN role that is a member of `airen_app` and `airen_auth`;
4. prove missing required configuration fails closed;
5. prove the container runs non-root;
6. prove liveness and readiness;
7. prove correlation/W3C trace propagation;
8. deploy a deliberately degraded database configuration and require readiness `NOT_READY`;
9. restore the exact known-good image/configuration and require readiness `READY`;
10. prove generated secret material is absent from archived deployment evidence.

The degraded-candidate/restore sequence is a deployment-mechanics rollback rehearsal. It does not replace later release-specific rollback verification between two distinct production release images.

## Explicitly outside B44-FX-014

- production hosting vendor selection;
- production authentication provider selection;
- production secret-manager vendor selection;
- production telemetry vendor selection;
- DNS/certificate/customer-domain cutover;
- T20 certification;
- Golden Restaurant E2E;
- Corte delle Stelle migration or production cutover.
