# R3-G — FEATURE / CAPABILITY RESOLUTION RECONCILIATION

Date: 2026-08-23
Milestone: R3-G
State: CLOSURE CANDIDATE / EXACT CI PENDING / NOT CLOSED

## Certified baseline
- Parent closure: R3-F `3592b7878e13e63b9cd97d76c9d98b146cbd7be3`.
- R3-G implementation commit: `6def5f4f64268c2f1f6de71dd1f19eeb8e1ee317`.
- R3-G implementation tree: `0cdd593a69b4823ae3ba20389eeb2406fc2edf05`.
- Implementation CI: foundation-contract-ci #398 / run `32635404011` — SUCCESS.
- Deployment artifact: `9492162397`, digest `sha256:a490d1df0b194d58b7a2e84a267b8e8bc30e5b48266dc913b8cff9fc2d54bbeb`.

## Design authorities
- Human: R3-G-001, Drive `1Gf6NUU3XAtETuHnke6pFZESI-bOGu0u5xZp2UGANzeU`.
- Machine: MRS-007, Drive `1TvOTK4aMNTNw4lUG3OJcmcn1S2H3eabm48H3UBoLRN0`.
- Frozen counts: 12 Platform permissions, 11 transitions, 16 invariants, 26 mandatory tests.

## Reconciled implementation
Implementation matches the frozen authority equation: Capability != Entitlement != Feature Flag != Permission. The runtime resolver preserves separate `available`, `authorized`, and `allowed` dimensions. Capability availability requires active capability state, all required effective Entitlements, Feature Flag allowance, and valid scope. Actor authorization consumes the existing Permission authority and does not create or mutate role grants.

The implementation introduces platform-owned `packages/capabilities`, additive migrations 0023–0026, governed Capability and Feature Flag lifecycle functions, logical Feature Flag override removal with historical rows, deterministic override precedence location > tenant > default, request-hash idempotency, atomic CapabilityEvent/Audit/Outbox evidence, PostgreSQL Platform-permission recheck, direct runtime-role DML denial, and a zero-argument current-context capability availability resolver.

R3-G consumes R3-F `resolve_current_tenant_entitlements()` and does not calculate Entitlements from Plans/Subscriptions. Resolution is side-effect free for billing Subscriptions and Tenant Entitlements. No Corte-specific or RISTOAIREN-specific Platform authority was introduced.

## Runtime evidence reconciliation
CI #398 verified:
- application-contracts = SUCCESS;
- postgres-rls-runtime = SUCCESS;
- deployment-path-runtime = SUCCESS;
- explicit R3-G PostgreSQL runtime suite = SUCCESS;
- R3-A through R3-F regression suites = SUCCESS.

The runtime test artifact preserves explicit R3G-T01..R3G-T26 markers. The final runtime-test source blob is `0cf6cf4102b1085c64d2a44fa1be5027e6f19ddb`, file SHA-256 `9ea199137de7d18e83c2cb16465d892bf7e305cc32de3c4956d70f7b740db2e9`. The earlier local-only hash `8b4e679439a47b6d8bdadca66a7c0db68931acef` was never published and is non-canonical.

## Authority boundaries retained
- Feature Flag cannot grant a missing Entitlement.
- Entitlement cannot grant a missing Permission.
- Feature/default/override state cannot reactivate a retired Capability.
- Tenant/Location identity comes from trusted runtime context.
- Runtime roles receive no direct R3-G lifecycle DML authority.
- Platform mutations are independently permission-checked in PostgreSQL.
- Resolver returns safe tenant-facing projection without override provenance or unrelated Tenant metadata.
- No Plan/Subscription/Entitlement/role/permission mutation is performed by R3-G resolution.

## Out of scope remains unchanged
No percentage rollout, experiment engine, user-cohort segmentation, usage metering, Product/Vertical manifest pipeline, Admin API/UI, R3-H Audit Query, T20, Golden Restaurant E2E, Corte production cutover or Base44 decommission is certified by R3-G.

## Closure candidate decision
R3-G implementation evidence is reconciled with R3-G-001 and MRS-007. No unresolved authority or security gap is identified by the implementation CI evidence. The milestone may advance to a closure-only commit containing this reconciliation and its machine evidence, followed by exact CI. It MUST NOT be marked CLOSED/PASS until exact CI, 04.3 archive/integrity, 04.1 final machine evidence and canonical Drive promotion are complete.
