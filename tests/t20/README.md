# T20 security harness

State: `DECISION_PACKET_READY_UNAPPROVED` / verdict: `INCOMPLETE` / certification claim: `false` / implementation authorized: `false`.

This directory will contain role-authenticated security tests. Required families include: expected allow, expected deny, cross-tenant, cross-location, platform-role vs tenant-role, privileged service principal, STELLA capability boundary, public guest capability, webhook trust-boundary, and audit evidence.

The T20-0 freeze binds all 66 mandatory DOC-014 tests to the controlled program. The first portable slice is `T20-S01-PORTABLE-BOOKING`, which maps 32 tests around `RST-E003 Booking`; the other 34 remain mandatory and are not waived. The canonical private Booking read/query contract is still unresolved, so no test implementation or runtime claim is authorized by the freeze.

The exact file and contract census confirmed 13 blocking gaps. Reusable Foundation security primitives exist, but the Booking runtime, persistence/RLS, private API/DTO, Booking idempotency, exact role grants, exact status permission, canonical entitlement binding, authenticated fixtures, executable T20 tests and cleanup are absent or unresolved. No new implementation path is authorized by the census.

The narrow governance amendment proposal converts those findings into explicit decision requests without changing a canonical contract. Evidence-backed candidates are marked `PROPOSED_UNAPPROVED`; unresolved identifiers, entitlement policy, SQL details, DTOs, outbox names and file paths remain unassigned. The proposal also records the unresolved `responsabile` versus `responsabile_cucina` role-key discrepancy. No executable harness work may begin until the decisions are explicitly accepted and read back.

See `docs/T20-0_SECURITY_CERTIFICATION_SCOPE_FREEZE.md`, `docs/T20_PORTABLE_BOOKING_EXACT_FILE_CONTRACT_CENSUS.md`, `docs/T20_PORTABLE_BOOKING_GOVERNANCE_AMENDMENT_PROPOSAL.md`, `machine-context/t20-portable-booking-slice.json`, `machine-context/t20-portable-booking-file-contract-census.json`, `machine-context/t20-portable-booking-governance-amendment-proposal.json`, and `machine-context/t20-security-certification-baseline.json`.

**No T20 PASS without real authenticated runtime evidence and verified synthetic-fixture cleanup.** Source-level architecture decisions are not a security certificate.
