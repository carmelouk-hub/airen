import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { startFoundationAttachmentHttpServer } from "../../apps/api/src/foundation-attachment-staging-server.ts";

test("Foundation Attachment runtime is a separate exported process and composes canonical authority adapters", async () => {
  assert.equal(typeof startFoundationAttachmentHttpServer,"function");
  const source=await readFile("apps/api/src/foundation-attachment-staging-server.ts","utf8");
  assert.match(source,/createRa01AirenOSAuthentication/);
  assert.match(source,/Ed25519AirenOSSessionVerifier/);
  assert.match(source,/RevocationAwareAirenOSSessionVerifier/);
  assert.match(source,/PostgresRistoairenExperienceHandoffStore/);
  assert.match(source,/PostgresEntitlementControlPlaneStore/);
  assert.match(source,/createPilotAttachmentProjectionPublisher/);
  assert.match(source,/attachmentProjectionPublisher/);
  assert.match(source,/airenos-foundation-attachment-staging/);
  assert.doesNotMatch(source,/startSessionAuthorityStagingServer/);
});

test("Foundation Attachment runtime source contains no Pilot credential or endpoint literal", async () => {
  const source=await readFile("apps/api/src/foundation-attachment-staging-server.ts","utf8");
  const publisher=await readFile("apps/api/src/ra01-pilot-registry-publisher.ts","utf8");
  assert.equal(source.includes("opaque-foundation-test-credential"),false);
  assert.equal(publisher.includes("pilot.example.test"),false);
  assert.equal(publisher.includes("availability.read"),false);
  assert.match(publisher,/AIRENOS_PILOT_ATTACHMENT_REGISTRY_URL/);
  assert.match(publisher,/AIRENOS_FOUNDATION_REGISTRY_SERVICE_CREDENTIAL/);
});
