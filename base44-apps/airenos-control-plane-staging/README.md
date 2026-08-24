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
```

Use the Base44 CLI only through the local package runner:

```bash
npx base44 whoami
npx base44 deploy
```

Deployment is not authorized by the current Creation Gate.
