# RistoAIRen — Base44 staging

Tenant/Location-scoped staging shell for the RistoAIRen restaurant vertical.

## Boundary

- The app may consume only accepted AIRenOS contracts.
- Client-supplied Tenant or Location values are never authority.
- Booking is a locked design view until the portable contract, T20 and Golden Restaurant E2E are complete.
- No production data, operational entities, connectors, agents or secrets are present.
- STELLA has no direct operational-write path.

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
