# T20 security harness

State: `DESIGN_FROZEN` / verdict: `INCOMPLETE` / certification claim: `false`.

This directory will contain role-authenticated security tests. Required families include: expected allow, expected deny, cross-tenant, cross-location, platform-role vs tenant-role, privileged service principal, STELLA capability boundary, public guest capability, webhook trust-boundary, and audit evidence.

The T20-0 freeze binds all 66 mandatory DOC-014 tests to the controlled program. The first portable slice is `T20-S01-PORTABLE-BOOKING`, which maps 32 tests around `RST-E003 Booking`; the other 34 remain mandatory and are not waived. The canonical private Booking read/query contract is still unresolved, so no test implementation or runtime claim is authorized by the freeze.

See `docs/T20-0_SECURITY_CERTIFICATION_SCOPE_FREEZE.md`, `machine-context/t20-portable-booking-slice.json`, and `machine-context/t20-security-certification-baseline.json`.

**No T20 PASS without real authenticated runtime evidence and verified synthetic-fixture cleanup.** Source-level architecture decisions are not a security certificate.
