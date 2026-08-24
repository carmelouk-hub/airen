# T20 security harness

State: `CENSUS_COMPLETE_FAIL_CLOSED` / verdict: `INCOMPLETE` / certification claim: `false` / implementation authorized: `false`.

This directory will contain role-authenticated security tests. Required families include: expected allow, expected deny, cross-tenant, cross-location, platform-role vs tenant-role, privileged service principal, STELLA capability boundary, public guest capability, webhook trust-boundary, and audit evidence.

The T20-0 freeze binds all 66 mandatory DOC-014 tests to the controlled program. The first portable slice is `T20-S01-PORTABLE-BOOKING`, which maps 32 tests around `RST-E003 Booking`; the other 34 remain mandatory and are not waived. The canonical private Booking read/query contract is still unresolved, so no test implementation or runtime claim is authorized by the freeze.

The exact file and contract census confirmed 13 blocking gaps. Reusable Foundation security primitives exist, but the Booking runtime, persistence/RLS, private API/DTO, Booking idempotency, exact role grants, exact status permission, canonical entitlement binding, authenticated fixtures, executable T20 tests and cleanup are absent or unresolved. No new implementation path is authorized by the census.

See `docs/T20-0_SECURITY_CERTIFICATION_SCOPE_FREEZE.md`, `docs/T20_PORTABLE_BOOKING_EXACT_FILE_CONTRACT_CENSUS.md`, `machine-context/t20-portable-booking-slice.json`, `machine-context/t20-portable-booking-file-contract-census.json`, and `machine-context/t20-security-certification-baseline.json`.

**No T20 PASS without real authenticated runtime evidence and verified synthetic-fixture cleanup.** Source-level architecture decisions are not a security certificate.
