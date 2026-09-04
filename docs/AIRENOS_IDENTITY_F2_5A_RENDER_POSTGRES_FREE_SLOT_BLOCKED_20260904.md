# AIRENOS IDENTITY F2.5A — RENDER IDENTITY POSTGRES FREE-SLOT BLOCK

Date: 2026-09-04
Governance: RULE-DOC-20 / RULE-DOC-21
Parent gate: F2.5 Render-first staging authorization
Classification: PROVIDER APPLY ATTEMPT / FAIL-CLOSED / NO RESOURCE CREATED

## 1. Authorized action attempted

After fresh dual-source reconciliation and F2.5 canonical registration, a dedicated no-cost Render PostgreSQL staging resource was requested in workspace AIRENOS with the following non-sensitive intended configuration:

- name: `airenos-identity-f25-staging-db`
- region: `frankfurt`
- plan: `free`
- PostgreSQL major: `16`
- purpose: AIRenOS Identity non-production staging only

No existing RISTOAIREN / AIRen Booking resource was targeted or mutated.

## 2. Provider result

Render rejected the creation request with HTTP 400 because the workspace cannot have more than one active free-tier database.

Provider response classification:

`FREE_TIER_DATABASE_CAPACITY_ALREADY_CONSUMED`

No AIRenOS Identity PostgreSQL resource was created.

No database credential, connection string, private key, or secret value is recorded in this evidence.

## 3. Remote read-back

Post-attempt Render read-back showed only the pre-existing managed PostgreSQL instance:

- resource ID: `dpg-da87bdad0e5s739slf20-a`
- name: `ristoairen-rbl01c2-db`
- region: `frankfurt`
- plan: `free`
- PostgreSQL major: `18`
- status: `available`
- high availability: `false`
- expiry: `2026-09-26T17:36:53.7409Z`

The intended `airenos-identity-f25-staging-db` resource is absent.

## 4. Protected-boundary decision

The pre-existing `ristoairen-rbl01c2-db` database MUST NOT be reused, repurposed, deleted, suspended, upgraded, or otherwise changed merely to free the free-tier slot for Identity.

The existing RISTOAIREN / AIRen Booking Render resources remain protected and outside the AIRenOS Identity state boundary.

## 5. Cost gate

F2.5 authorized no-cost non-production provider apply only. The free-tier capacity constraint means the next dedicated managed PostgreSQL option is billable.

Therefore:

`PAID_IDENTITY_POSTGRES_CREATE = NOT_EXECUTED`

A paid Identity PostgreSQL resource requires a separate explicit cost-bounded authorization before creation.

No provider payment-card operation has been performed.

## 6. Gate state

`F2_5A_PROVIDER_ATTEMPT = EXECUTED`

`DEDICATED_IDENTITY_POSTGRES = NOT_CREATED`

`FREE_TIER_SLOT = UNAVAILABLE`

`EXISTING_RISTOAIREN_DATABASE = UNCHANGED`

`BILLABLE_ACTION = NOT_EXECUTED`

`PRODUCTION = FALSE`

Fail-closed behavior is preserved. No later F2.4 evidence step may be promoted until the dedicated Identity PostgreSQL boundary exists and its schema/runtime-role proof is complete.

END OF F2.5A
