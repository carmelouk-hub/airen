# AIRenOS Foundation

Status: **B44-FX-007 / R0 GITHUB BOOTSTRAP — FOUNDATION RUNTIME NOT YET OPERATIONAL**

This repository is the governed portable target for AIRenOS Foundation. It is derived from the AIRenOS Platform Bible, B44-FX forensic evidence, B44-FX-004 boundary mapping, and the 13 accepted B44-FX-005 ADRs.

## Non-negotiables
- AIRenOS is the control plane.
- RISTOAIREN is the hospitality vertical.
- Tenant is the universal SaaS root; Location is first-class.
- Identity is separated from TenantMembership and LocationMembership.
- Platform roles and tenant roles are separate authority planes.
- Tenant identity is never trusted from browser, AI tool, or webhook payload.
- Unknown hostname fails closed.
- STELLA executes governed named capabilities and never writes raw DB state.
- Secrets live outside operational data and source control.
- Corte delle Stelle remains a tenant, not product identity or destructive fixture.
- T20 and Golden Restaurant are release gates.

The December 2025 Next.js prototype is preserved under `legacy/airen-2025-prototype/` for provenance only.

## Current gate
G3 source-level architecture: PASS. G4 operational Foundation: PENDING. No Corte production change is part of this bootstrap.
