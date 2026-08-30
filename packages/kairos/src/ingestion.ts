import { createHash } from "node:crypto";
import type { KnowledgeSourceAdapter, KairosNativeContentType, KairosSourceSnapshot } from "./source-adapters.ts";
import { NativeParserRegistry, type ParsedKnowledgeUnit } from "./parsers.ts";
import { assertKairosSecretFree } from "./secret-exclusion.ts";

export interface OcrFallbackAdapter {
  readonly adapterKey: string;
  extractText(snapshot: KairosSourceSnapshot): Promise<Readonly<{ text: string; contentType?: KairosNativeContentType }>>;
}

export type IngestionCheckpoint = Readonly<{
  revisionKey: string;
  contentHash: string;
}>;

export type KairosIngestionEnvelope = Readonly<{
  status: "READY_NEW_SOURCE" | "READY_NEW_REVISION" | "UNCHANGED";
  source: KairosSourceSnapshot;
  revision: Readonly<{
    revisionKey: string;
    contentHash: string;
    parserKind: string;
    nativeTextAvailable: boolean;
    ocrFallbackUsed: boolean;
    secretScanStatus: "PASS";
    containsSecretValues: false;
  }>;
  units: readonly ParsedKnowledgeUnit[];
}>;

function normalizedContent(text: string): string {
  return text.replace(/\r\n?/g,"\n").normalize("NFC");
}

function sha256(text: string): string {
  return createHash("sha256").update(text,"utf8").digest("hex");
}

export class KairosIngestionPipeline<TInput> {
  constructor(
    private readonly sourceAdapter: KnowledgeSourceAdapter<TInput>,
    private readonly parsers: NativeParserRegistry = new NativeParserRegistry(),
    private readonly ocrFallback?: OcrFallbackAdapter,
  ) {}

  async prepare(input: TInput, previous?: IngestionCheckpoint): Promise<KairosIngestionEnvelope> {
    const source=await this.sourceAdapter.read(input);
    const nativeTextAvailable=source.nativeText !== undefined;
    let text=source.nativeText;
    let contentType=source.nativeContentType;
    let ocrFallbackUsed=false;

    if(text === undefined) {
      if(!this.ocrFallback)throw new Error("Kairos native text is unavailable and no OCR fallback adapter is configured");
      const ocr=await this.ocrFallback.extractText(source);
      text=ocr.text;
      contentType=ocr.contentType ?? "TEXT";
      ocrFallbackUsed=true;
    }

    const normalized=normalizedContent(text);
    const secretAttestation=assertKairosSecretFree(source,normalized);
    const contentHash=sha256(normalized);

    if(previous?.revisionKey === source.revisionKey && previous.contentHash !== contentHash) {
      throw new Error("Kairos source revision key was reused for different content");
    }

    const parsed=this.parsers.parse(contentType,normalized);
    const status: KairosIngestionEnvelope["status"] = !previous
      ? "READY_NEW_SOURCE"
      : previous.revisionKey===source.revisionKey && previous.contentHash===contentHash
        ? "UNCHANGED"
        : "READY_NEW_REVISION";

    return Object.freeze({
      status,
      source,
      revision:Object.freeze({
        revisionKey:source.revisionKey,
        contentHash,
        parserKind:parsed.parserKind,
        nativeTextAvailable,
        ocrFallbackUsed,
        secretScanStatus:secretAttestation.status,
        containsSecretValues:false as const,
      }),
      units:parsed.units,
    });
  }
}
