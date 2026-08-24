# AIRenOS Control Plane — Base44 staging

Non-authoritative staging shell for the AIRenOS administrative and Relationship Intelligence OS experience.

## Boundary

- Base44 hosts the application experience only.
- AIRenOS Foundation remains the authority for Tenant, Location, identity, roles, permissions, entitlements, audit, outbox, consent and operational state.
- No production data, operational entities, connectors, agents or secrets are present.
- Runtime promotion is blocked while T20 and Golden Restaurant E2E remain incomplete.

## Local development

```bash
npm install
npm run dev
npm run build
npm run test:design-boundary
```

Use the Base44 CLI only through the local package runner:

```bash
npx base44 whoami
npx base44 deploy
```

Deployment is not authorized by the current Creation Gate.

## Relationship Intelligence design review

The current milestone provides five non-operational review sections:

- overview;
- synthetic Customer Relationship Twin;
- synthetic Supplier Relationship Twin;
- Purpose & Authorization Graph with six disabled candidate purposes;
- NEXT-AIR-002 governed-design and runtime-gate review.

All content is read-only and synthetic. `NEXT-AIR-002` is authorized for governed design only; it remains non-canonical with implementation and canonical/runtime promotion disabled.
