import test from "node:test";
import assert from "node:assert/strict";
import {
  GitHubNativeSourceAdapter,
  GoogleDriveNativeSourceAdapter,
  type GitHubNativeReader,
  type GoogleDriveNativeReader,
  type KairosSourceSnapshot,
  type KnowledgeSourceAdapter,
} from "../../packages/kairos/src/source-adapters.ts";
import { NativeParserRegistry } from "../../packages/kairos/src/parsers.ts";
import { KairosIngestionPipeline, type OcrFallbackAdapter } from "../../packages/kairos/src/ingestion.ts";
import { KairosSecretExclusionError, scanKairosSourceForSecrets } from "../../packages/kairos/src/secret-exclusion.ts";

function staticAdapter(snapshot: KairosSourceSnapshot): KnowledgeSourceAdapter<void> {
  return { async read() { return snapshot; } };
}

function snapshot(overrides: Partial<KairosSourceSnapshot> = {}): KairosSourceSnapshot {
  return Object.freeze({
    sourceKey:"github:carmelouk-hub/airen:docs/example.md",
    sourceType:"GITHUB",
    canonicalPointer:"https://github.com/carmelouk-hub/airen/blob/test/docs/example.md",
    title:"example.md",
    revisionKey:"a".repeat(40),
    observedAt:"2026-08-30T13:45:00Z",
    nativeText:"# Title\n\nCanonical content",
    nativeContentType:"MARKDOWN",
    metadata:Object.freeze({ repository:"carmelouk-hub/airen", path:"docs/example.md", ref:"test", blobSha:"a".repeat(40) }),
    ...overrides,
  });
}

test("K3-B Google Drive and GitHub adapters preserve provider revision and canonical pointer", async () => {
  const driveReader: GoogleDriveNativeReader = {
    async readDocument(documentId) {
      return { documentId,title:"Design",revisionId:"drive-r7",mimeType:"application/vnd.google-apps.document",observedAt:"2026-08-30T13:45:00Z",nativeText:"Native Drive text" };
    },
  };
  const drive = await new GoogleDriveNativeSourceAdapter(driveReader).read({ documentId:"doc-123" });
  assert.equal(drive.sourceKey,"gdrive:doc-123");
  assert.equal(drive.revisionKey,"drive-r7");
  assert.match(drive.canonicalPointer,/doc-123$/);
  assert.equal(drive.nativeContentType,"GOOGLE_DOC");

  const githubReader: GitHubNativeReader = {
    async readFile(input) {
      return { ...input,blobSha:"b".repeat(40),observedAt:"2026-08-30T13:46:00Z",text:"{\"ok\":true}" };
    },
  };
  const github = await new GitHubNativeSourceAdapter(githubReader).read({ repository:"carmelouk-hub/airen",path:"machine-context/example.json",ref:"test" });
  assert.equal(github.revisionKey,"b".repeat(40));
  assert.equal(github.nativeContentType,"JSON");
  assert.match(github.canonicalPointer,/machine-context\/example\.json$/);
});

test("K3-B native text is parsed without invoking OCR", async () => {
  let ocrCalls=0;
  const ocr: OcrFallbackAdapter = {
    adapterKey:"test-ocr",
    async extractText() { ocrCalls += 1; return { text:"OCR should not run" }; },
  };
  const result=await new KairosIngestionPipeline(staticAdapter(snapshot()),new NativeParserRegistry(),ocr).prepare();
  assert.equal(ocrCalls,0);
  assert.equal(result.revision.nativeTextAvailable,true);
  assert.equal(result.revision.ocrFallbackUsed,false);
  assert.equal(result.revision.secretScanStatus,"PASS");
  assert.ok(result.units.some((unit)=>unit.heading==="Title"));
});

test("K3-B OCR runs exactly once only when native text is unavailable and remains behind secret gate", async () => {
  let ocrCalls=0;
  const ocr: OcrFallbackAdapter = {
    adapterKey:"test-ocr",
    async extractText() { ocrCalls += 1; return { text:"Scanned policy text",contentType:"TEXT" }; },
  };
  const imageOnly=snapshot({ nativeText:undefined,nativeContentType:"TEXT",revisionKey:"c".repeat(40),title:"scan.pdf",metadata:Object.freeze({ path:"evidence/scan.pdf" }) });
  const result=await new KairosIngestionPipeline(staticAdapter(imageOnly),new NativeParserRegistry(),ocr).prepare();
  assert.equal(ocrCalls,1);
  assert.equal(result.revision.nativeTextAvailable,false);
  assert.equal(result.revision.ocrFallbackUsed,true);
  assert.equal(result.revision.secretScanStatus,"PASS");

  const secretOcr: OcrFallbackAdapter = {
    adapterKey:"test-secret-ocr",
    async extractText() { return { text:"Authorization: Bearer synthetic-token-value",contentType:"TEXT" }; },
  };
  await assert.rejects(
    () => new KairosIngestionPipeline(staticAdapter(imageOnly),new NativeParserRegistry(),secretOcr).prepare(),
    (error: unknown) => error instanceof KairosSecretExclusionError && error.findingKinds.includes("BEARER_TOKEN"),
  );
});

test("K3-B secret gate reports categories only and blocks sensitive source paths", async () => {
  const secretFile=snapshot({
    title:".env",
    nativeText:"SAFE_PLACEHOLDER_ONLY=true",
    metadata:Object.freeze({ path:"runtime/.env" }),
  });
  const scan=scanKairosSourceForSecrets(secretFile,secretFile.nativeText ?? "");
  assert.equal(scan.status,"REJECTED");
  assert.deepEqual(scan.findingKinds,["SECRET_FILE_PATH"]);
  await assert.rejects(
    () => new KairosIngestionPipeline(staticAdapter(secretFile)).prepare(),
    (error: unknown) => error instanceof KairosSecretExclusionError && error.message === "Kairos secret-exclusion gate rejected source material",
  );
});

test("K3-B revision checkpoints are idempotent and revision-key reuse with changed content fails closed", async () => {
  const first=await new KairosIngestionPipeline(staticAdapter(snapshot())).prepare();
  const unchanged=await new KairosIngestionPipeline(staticAdapter(snapshot())).prepare(undefined,{ revisionKey:first.revision.revisionKey,contentHash:first.revision.contentHash });
  assert.equal(unchanged.status,"UNCHANGED");

  const newRevision=snapshot({ revisionKey:"d".repeat(40),nativeText:"# Title\n\nCanonical content v2" });
  const changed=await new KairosIngestionPipeline(staticAdapter(newRevision)).prepare(undefined,{ revisionKey:first.revision.revisionKey,contentHash:first.revision.contentHash });
  assert.equal(changed.status,"READY_NEW_REVISION");
  assert.notEqual(changed.revision.contentHash,first.revision.contentHash);

  const reusedRevision=snapshot({ nativeText:"# Title\n\nSilently changed content" });
  await assert.rejects(
    () => new KairosIngestionPipeline(staticAdapter(reusedRevision)).prepare(undefined,{ revisionKey:first.revision.revisionKey,contentHash:first.revision.contentHash }),
    /revision key was reused for different content/,
  );
});

test("K3-B parser decomposition is stable for Markdown and JSON source coordinates", () => {
  const registry=new NativeParserRegistry();
  const markdown=registry.parse("MARKDOWN","# One\nAlpha\n\n## Two\nBeta");
  assert.deepEqual(markdown.units.map((unit)=>[unit.ordinal,unit.heading,unit.sourceAnchor]),[
    [0,"One","lines:1-3"],
    [1,"Two","lines:4-5"],
  ]);

  const json=registry.parse("JSON",'{"z":1,"a":{"b":2}}');
  assert.deepEqual(json.units.map((unit)=>unit.sourceAnchor),["$.a.b","$.z"]);
});
