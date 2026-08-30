# AIRenOS Identity & Session Authority — F2 Upstream OIDC Adapter

Date: 2026-08-31
Gate: `ISA_F2_REAL_UPSTREAM_OIDC_PROVIDER_ADAPTER`
Status of this artifact: implementation contract; real IdP binding and provider-verified evidence remain pending.

## Purpose

F2 extends the certified AIRenOS F0/F1 identity and session foundation with a provider-neutral OpenID Connect adapter for a real upstream Identity Provider. It does not create a second identity authority and it does not give Base44, a browser, or an upstream provider authority over AIRenOS tenants, roles, permissions, memberships or entitlements.

The adapter terminates the upstream OIDC authentication proof and returns only a verified provider subject plus authentication/session metadata. Canonical AIRenOS Identity linking remains the responsibility of `AirenOSIdentitySessionAuthority`, and canonical AIRenOS authorization remains server-side.

## Normative protocol baseline

F2 is frozen against stable, published authorities:

- OpenID Connect Core 1.0 incorporating errata set 2.
- OAuth 2.0 Security Best Current Practice — RFC 9700.
- Proof Key for Code Exchange — RFC 7636, S256 only.
- OAuth 2.0 Authorization Server Metadata / interoperable metadata principles — RFC 8414 where applicable.

OAuth 2.1 is deliberately not a normative dependency while it remains an IETF Internet-Draft.

## F2 trust contract

1. The configured upstream issuer MUST be an exact, clean HTTPS issuer URL.
2. OIDC Discovery MUST return an `issuer` exactly equal to the configured issuer.
3. The provider MUST advertise Authorization Code response type and PKCE `S256`.
4. Browser/public-client code exchange MUST send `grant_type=authorization_code`, exact configured `client_id`, exact configured `redirect_uri`, one-time authorization code and RFC 7636 code verifier. No client secret is accepted from browser request state.
5. The upstream token endpoint response is not AIRenOS authority. An upstream access token is never re-used as an AIRenOS bearer.
6. The OIDC ID Token MUST be cryptographically verified against provider JWKS before a provider subject can be accepted.
7. Accepted ID-token algorithms are explicitly allowlisted to `RS256`, `ES256`, or `EdDSA`; `alg=none`, algorithm confusion and disabled/unknown keys fail closed.
8. Canonical Base64URL encoding, exact `iss`, exact client audience, `azp` rules for multiple audiences, `exp`, `iat`, optional `nbf`, bounded authentication freshness and exact `nonce` are enforced.
9. JWKS key rotation is supported by bounded cache plus one forced refresh on an unknown `kid`.
10. The only identity output is `providerKey + providerSubject` with authentication metadata. Browser-supplied tenant IDs, roles, entitlements or similar authority claims are ignored.
11. Canonical provider-subject-to-AIRenOS-Identity resolution still occurs after F2 verification through the existing identity directory.
12. F1 persistent session registration and revocation still govern AIRenOS session validity after AIRenOS mints its own short-lived Ed25519 access token.

## Exact implementation surface

- `packages/integrations/src/oidc-upstream-provider.ts`
  - `OidcAuthorizationCodeUpstreamVerifier`
  - `oidcPkceS256Challenge`
- `tests/integration/airenos-oidc-upstream-provider.test.ts`
- package export and dedicated ISA workflow wiring
- machine-context registration for F2

No F2 database migration is required. No browser UI, Base44 code, K4 staging deployment, production deployment, upstream IdP account creation, client registration or secret is introduced by this contract.

## Browser handoff boundary

F2 accepts only the server-side result needed to redeem an Authorization Code: `code`, `codeVerifier`, and `expectedNonce`. Browser transaction state/anti-CSRF binding, popup/window origin binding, authorization-request creation and final AIRenOS-to-Base44 handoff belong to F3.

The redirect URI is configured server-side and is never accepted as browser authority.

## Failure behavior

- malformed code/PKCE/nonce input -> no verified identity;
- token endpoint denial -> no verified identity;
- discovery/JWKS unavailability -> fail closed with upstream-unavailable error;
- discovery issuer mismatch or missing required provider capability -> fail closed as runtime configuration invalid;
- ID-token signature/claims/key mismatch -> no verified identity.

No failure path silently falls back to preview/demo identity or Base44 authentication.

## Certification boundary / non-claim

Generated keys and injected transport responses in the F2 contract tests prove only deterministic protocol and cryptographic behavior. They are NOT evidence that a real upstream IdP has been selected, registered, logged into or successfully exchanged a real Authorization Code.

Therefore this implementation alone MUST NOT set `ISA_F2_REAL_UPSTREAM_OIDC_PROVIDER_ADAPTER = CLOSED/PASS`, MUST NOT certify real browser login, and MUST NOT close `K4_C3_RUNTIME_DEPLOY_SESSION_HANDOFF_PROOF`.

A later governed provider-binding proof must use an explicitly selected real IdP, real client registration, real HTTPS redirect URI and provider-verified exchange without disclosing secrets in GitHub, Drive, Base44, logs or Kairos.
