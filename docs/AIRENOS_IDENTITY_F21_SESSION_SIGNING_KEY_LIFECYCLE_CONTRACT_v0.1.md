# AIRenOS Identity F2.1 — Session Signing Key Lifecycle Contract v0.1

Date: 2026-09-03  
Gate: `ISA_F2_1_SESSION_SIGNING_KEY_LIFECYCLE`  
Base certified Identity checkpoint: `87cc356785e5527b571f9cc707b9b17a5382400e`  
Target status: `STATIC_CONTRACT_IMPLEMENTED / LIVE_KEY_MATERIAL_NOT_CREATED`

## 1. Purpose

This checkpoint closes a static gap between the certified AIRenOS F0/F1 Ed25519 Session Authority and a future real staging binding. It defines how AIRenOS session signing keys are generated, identified, fingerprinted, distributed to verifiers and rotated without moving signing authority into Foundation, Keycloak, Base44 or an experience layer.

It does **not** create a real staging key, bind a provider secret/KMS service, provision OVHcloud or Render, change DNS/TLS, deploy Keycloak, issue a real browser session or close RA-01/K4-C3.

## 2. Frozen authority boundary

The AIRenOS Session Authority is the sole owner of session-signing private material.

The governed relationship is:

`AIRenOS Session Authority private Ed25519 key -> AIRenOS bearer signature -> public JWK keyring -> Foundation verifier`

Foundation receives public verification material only through its existing `AUTH_SESSION_PUBLIC_KEYS_JSON` binding. Foundation must not receive a private signing key and must not issue AIRenOS sessions. Keycloak remains an upstream authentication engine and does not sign canonical AIRenOS bearers. Base44 remains presentation-only and receives no signing key authority.

The canonical issuer remains `https://session.airenos.com` and the RA-01 verifier audience remains `airenos-foundation`.

## 3. Cryptographic representation

- asymmetric algorithm: Ed25519;
- JWT `alg`: `EdDSA`;
- JWT `typ`: `at+jwt`;
- private serialization for the provider-neutral bootstrap utility: PKCS#8 PEM;
- public serialization: JWK with exactly the public Ed25519 members required by the runtime (`kty=OKP`, `crv=Ed25519`, `x`);
- the private JWK member `d` is forbidden from the public keyring;
- public-key identity uses the RFC 7638 SHA-256 JWK thumbprint encoded as base64url.

The verifier keyring keeps the existing F0 shape:

`{"<kid>":{"key":<public-jwk>,"enabled":true}}`

No new token format or alternate verifier is introduced.

## 4. Provider-neutral bootstrap utility

`scripts/bootstrap-airenos-session-signing-key.ts` is an operator utility, not a live provisioning action.

It must:

1. generate an Ed25519 keypair using the Node.js cryptographic runtime;
2. require an explicit `kid`;
3. create the private PKCS#8 file and the public keyring using exclusive create semantics — existing material must never be overwritten;
4. enforce file mode `0600` for both generated files;
5. reject output paths inside the current repository/worktree by default;
6. emit only `kid`, public JWK thumbprint and public-keyring path as successful machine output;
7. never emit the private key value to stdout/stderr;
8. remove the newly-created private file if public-keyring creation fails.

Example operator shape for a **future authorized host**, not for execution in CI or chat:

```text
node --experimental-strip-types scripts/bootstrap-airenos-session-signing-key.ts \
  --kid <governed-kid> \
  --private-key-out <host-only-secret-path> \
  --public-keyring-out <controlled-public-handoff-path>
```

A successful invocation proves only local key generation. It does not prove Secret Manager/KMS binding or live Session Authority deployment.

## 5. Secret and evidence boundary

Raw private signing material is prohibited from:

- Git and committed repository files;
- Google Drive;
- Base44;
- Terraform variables/state designed by this gate;
- OCI image layers;
- CI artifacts or logs;
- chat.

The live staging execution remains blocked until the separately governed provider preflight proves the selected secret/KMS or equivalent protection boundary, IAM/workload identity and read-back path.

CI may generate an **ephemeral test-only keypair** inside a temporary directory in order to prove compatibility with the certified F0 issuer/verifier. Such a fixture is destroyed before the test exits and is never live evidence.

## 6. Public keyring binding to Foundation / RA-01

After a separately authorized live Session Authority bootstrap, the only material that may cross into Foundation is the public keyring and its independently verifiable `kid`/RFC 7638 thumbprint.

RA-01 must not claim the public keyring as bound until all of the following are independently proven:

1. the Session Authority reports the governed public JWK thumbprint without exposing private material;
2. the Foundation provider binding contains the intended public keyring;
3. an independent read-back derives the same thumbprint from Foundation's effective verifier binding;
4. a real AIRenOS session issued under that `kid` is accepted only when its persisted F1 session is active;
5. the same session is denied after F1 revocation.

The existing CI proof for synthetic/ephemeral F0/F1 composition remains valuable regression evidence but cannot satisfy this live gate.

## 7. Rotation contract

Normal rotation is overlap-first and fail-closed:

1. generate a new key on the Session Authority boundary with a new `kid`;
2. publish **both old and new public keys as enabled** to every AIRenOS verifier;
3. independently read back and match the new JWK thumbprint from every verifier binding;
4. only then switch the Session Authority issuer to the new `kid`;
5. keep the old public key enabled for at least the maximum bearer TTL (`300s`) plus verifier clock skew (`30s`) after the last possible issuance under the old `kid` — minimum overlap `330s`;
6. disable the old public `kid` on verifiers;
7. prove a new-key bearer is accepted and an old-key bearer is rejected after the overlap window;
8. retire/destroy the old private key only under the live secret/KMS retention policy and after the previous steps are read back.

For a suspected key compromise, availability may be sacrificed: revoke affected AIRenOS sessions and disable the compromised `kid` immediately, then execute an emergency replacement under a separately recorded incident/security gate.

## 8. Provider dependency remains open

The certified F2 contract records OVHcloud account onboarding as `PAUSED / EXTERNAL_FISCAL_DATA_PENDING`. This F2.1 checkpoint does not change that fact and does not authorize billable provider creation.

Likewise, creating a static Render blueprint on RA-01 is not evidence of a Render service, database, secret binding or HTTPS endpoint.

## 9. Non-claims

This checkpoint is not evidence of:

- a real staging private key;
- a live public keyring;
- OVHcloud Secret Manager/KMS or equivalent binding;
- a deployed AIRenOS Session Authority;
- a Render Foundation deployment;
- `session.airenos.com` DNS/TLS;
- a real Keycloak Authorization Code exchange;
- a real AIRenOS browser session;
- a live RA-01 public-key binding;
- Base44 experience attachment;
- RA-01 closure;
- K4-C3 closure;
- production enablement.

All live fields remain fail-closed until independently proven against the real provider/runtime.
