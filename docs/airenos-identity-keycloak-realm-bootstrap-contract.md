# AIRenOS Identity — Keycloak realm bootstrap contract

Date: 2026-08-31
Status: provider-independent governed contract; live deployment not executed
Keycloak target: 26.7.2
Realm: `airenos`
Client: `airenos-browser-session`

## Purpose

This contract turns the previously descriptive Keycloak realm/client design into a machine-readable realm representation that Keycloak 26.7.2 can import. It does not create a live realm, does not create a live user, and does not prove DNS, TLS, an authorization-code exchange, or browser login.

`deploy/keycloak/realm/airenos-realm.json` is intentionally minimal. It creates only the `airenos` realm and one public OpenID Connect client. It contains no user seed, no group seed, no AIRenOS business role, no Identity Provider secret, no client secret, no password and no Tenant/Entitlement authority.

## Frozen OIDC client boundary

The imported client must preserve all of the following:

- client ID `airenos-browser-session`;
- OpenID Connect protocol;
- public client;
- Authorization Code flow enabled;
- PKCE required with `S256`;
- implicit flow disabled;
- direct access grants disabled;
- service accounts disabled;
- exact redirect URI `https://session.airenos.com/oidc/callback`;
- no wildcard redirect URI;
- no browser web origins;
- `fullScopeAllowed = false`;
- no custom protocol mapper that could turn Keycloak role/Tenant data into AIRenOS authority.

Keycloak authenticates only the upstream subject. AIRenOS Identity Directory remains canonical for Identity, Tenant membership, roles, permissions and entitlements. AIRenOS Session Authority remains the only authority that may issue an AIRenOS bearer/session.

## Bootstrap semantics

For the first empty Keycloak database, the governed bootstrap path is the Keycloak CLI import command against the dedicated Keycloak PostgreSQL database, before the live Keycloak cluster is started:

```text
kc.sh import --optimized --file <airenos-realm.json> --override false
```

`--override false` is deliberate. This seed is not an ongoing configuration-sync mechanism and must never silently overwrite an existing live realm. Once a live realm exists, later realm/client changes require a separate governed migration or Admin API procedure with provider read-back.

The production Kubernetes Deployment therefore continues to start Keycloak with `start --optimized`; it does not add `--import-realm` to every server startup. This prevents source-controlled seed material from being mistaken for a continuous desired-state authority over a live authentication database.

## CI runtime compatibility proof

The dedicated Identity & Session Authority workflow uses an ephemeral PostgreSQL 17 service and the exact governed Keycloak 26.7.2 image to prove that:

1. Keycloak accepts the realm JSON through its real CLI import path;
2. the imported `airenos` realm can start on the imported database;
3. the realm exposes real OpenID Connect discovery in the ephemeral CI runtime;
4. the Keycloak Admin API reads back exactly one `airenos-browser-session` client with the governed public-client, code-flow, redirect and PKCE settings;
5. no user is seeded into the `airenos` realm.

Any bootstrap administrator used by this CI job is generated only for the ephemeral `master` realm and exists only to read back the imported contract. It is not a real AIRenOS user, credential, browser-login proof or provider credential.

## Evidence classification

A successful CI import/read-back proves only:

`KEYCLOAK_REALM_BOOTSTRAP_RUNTIME_COMPATIBILITY = PASS`

It does **not** prove:

- a Keycloak deployment exists on OVHcloud;
- `login.airenos.com` or `identity-admin.airenos.com` resolves;
- TLS exists;
- the realm/client exists on a real provider;
- a real authorization code was issued or exchanged;
- a real human/browser login succeeded;
- Base44 authenticated into AIRenOS or Kairos.

Those remain later live-provider gates and must not be simulated.

## Live status

`KEYCLOAK_REALM_LIVE_IMPORT = NOT_EXECUTED`

`KEYCLOAK_REALM_PROVIDER_READBACK = NOT_EXECUTED`

`KEYCLOAK_CLIENT_PROVIDER_READBACK = NOT_EXECUTED`

`REAL_PROVIDER_AUTHORIZATION_CODE_EXCHANGE = NOT_EXECUTED`

`REAL_BROWSER_LOGIN = NOT_CERTIFIED`

`BASE44_AIRENOS_KAIROS_AUTHENTICATED_E2E = NOT_EXECUTED`
