# AIRenOS Identity F2.2 — Provider Gate Authorization Checkpoint

Date: 2026-09-03
Gate: `ISA_F2_2_PROVIDER_GATE_AUTHORIZATION`
Parent checkpoint: `55aac0a045e405c12e3b83ed1b5e91d77225c5c1`
Status: `AUTHORIZED_TO_PROCEED_WITH_NON_PRODUCTION_PROVIDER_ONBOARDING_AND_READ_ONLY_PREFLIGHT / LIVE_PROVIDER_ACCOUNT_NOT_YET_PROVEN`

## 1. Human authorization

The user explicitly authorized continuing from the F2.1 provider-gate resume point on 2026-09-03.

This authorization permits the governed AIRenOS team to proceed with the next non-production provider-gate steps required to establish the real Identity & Session Authority staging foundation, subject to RULE-DOC-20 / RULE-DOC-21 and the fail-closed conditions below.

It does not authorize production, PR #4 merge, Corte delle Stelle production changes, AIRen Booking attachment, AIRenPay attachment, Base44 authority changes, or any weakening of the certified AIRenOS authority boundary.

## 2. Current provider selection

Selected staging provider remains:

- provider: OVHcloud Public Cloud;
- region target: 3-AZ Milan / `EU-SOUTH-MIL`;
- environment: staging only;
- provisioning model: Terraform/IaC;
- provider identity for automation: OAuth2 service account using `CLIENT_CREDENTIALS`;
- AIRenOS authority remains provider-neutral.

No provider selection is changed by this checkpoint.

## 3. Authorized sequence

The authorized sequence is strictly ordered:

1. complete or verify OVHcloud account onboarding and fiscal/account identity data;
2. establish or verify the first Public Cloud project without creating governed runtime resources prematurely;
3. create a least-privilege OVHcloud OAuth2 service account for read-only provider inspection;
4. bind the service account credentials only through an approved secret channel outside Git, Drive, Base44 and chat;
5. execute the existing data-source-only Milan provider preflight;
6. independently read back project, region, AZ, flavor/quota and PostgreSQL capability evidence;
7. fail closed on any mismatch;
8. only after a successful provider preflight may a separate staging apply step be considered;
9. Secret Manager/KMS binding and the first real AIRenOS Ed25519 staging signing key remain later live gates;
10. production remains separately authorized.

## 4. Billing and resource boundary

This checkpoint authorizes provider onboarding and the read-only provider preflight.

It does **not** by itself certify or execute an uncontrolled billable infrastructure apply. Any billable staging resource creation remains contingent on:

- successful provider/account/quota preflight;
- exact infrastructure plan review;
- preservation of staging-only scope;
- provider-side cost visibility before apply;
- no production resources.

Creating an account, entering correct billing/fiscal identity information, creating a Public Cloud project in provider-supported discovery/readiness mode, creating an IAM service account, and executing the read-only provider preflight are not evidence of a live AIRenOS runtime.

## 5. Secret boundary

The following values must never be committed to GitHub, stored in Google Drive/Base44, pasted into chat, or emitted to CI logs:

- OVH OAuth2 `clientSecret`;
- any provider access token;
- session-signing private keys;
- Keycloak bootstrap credentials;
- PostgreSQL passwords;
- TLS private keys.

The governed provider preflight may consume `OVH_CLIENT_ID`, `OVH_CLIENT_SECRET` and `OVH_CLOUD_PROJECT_SERVICE` only from an approved secret/environment channel.

## 6. Current live evidence

At this checkpoint:

- OVHcloud account onboarding completion: NOT PROVEN;
- OVHcloud fiscal/account identity completion: NOT PROVEN;
- Public Cloud project service ID: NOT PROVEN;
- payment-method readiness: NOT PROVEN;
- OAuth2 service account: NOT PROVEN;
- protected secret binding: NOT PROVEN;
- read-only provider preflight: NOT EXECUTED;
- Milan 3-AZ provider read-back: NOT PROVEN;
- project quota: NOT PROVEN;
- PostgreSQL provider capability: NOT PROVEN;
- Secret Manager/KMS runtime binding: NOT PROVEN;
- staging signing private key: NOT CREATED;
- Foundation public keyring binding: NOT CREATED;
- real AIRenOS browser session: NOT PROVEN;
- RA-01 real-session verification: NOT PROVEN;
- production: FALSE.

## 7. Protected boundaries

Must remain unchanged throughout this gate unless separately authorized:

- PR #4 = OPEN / DRAFT / UNMERGED;
- R3 certified history unchanged;
- main unchanged;
- AOS-05 certified registry unchanged;
- RISTOAIREN experience remains non-authoritative;
- Base44 remains replaceable and cannot authorize AIRenOS product access;
- AIRen Booking and AIRenPay gates remain closed to this work;
- no production cutover.

## 8. Resume condition

The next live action is provider-account readiness in the OVHcloud Control Panel. Until the real account/project can be authenticated and read back, the gate remains:

`AUTHORIZED / EXTERNAL_PROVIDER_ACCOUNT_ACTION_REQUIRED / READ_ONLY_PREFLIGHT_PENDING / NO_RUNTIME_CLAIM`
