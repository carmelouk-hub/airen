export type KairosNativeContentType =
  | "TEXT"
  | "MARKDOWN"
  | "JSON"
  | "YAML"
  | "SQL"
  | "SOURCE"
  | "GOOGLE_DOC";

export type KairosSourceSnapshot = Readonly<{
  sourceKey: string;
  sourceType: "GOOGLE_DRIVE" | "GITHUB" | "RUNTIME_EVIDENCE" | "AIRENOS_INTERNAL";
  canonicalPointer: string;
  title: string;
  revisionKey: string;
  observedAt: string;
  nativeText?: string;
  nativeContentType: KairosNativeContentType;
  metadata: Readonly<Record<string, string | number | boolean | null>>;
}>;

export interface KnowledgeSourceAdapter<TInput> {
  read(input: TInput): Promise<KairosSourceSnapshot>;
}

export type GoogleDriveNativeDocument = Readonly<{
  documentId: string;
  title: string;
  revisionId: string;
  mimeType: string;
  observedAt: string;
  nativeText?: string;
}>;

export interface GoogleDriveNativeReader {
  readDocument(documentId: string): Promise<GoogleDriveNativeDocument>;
}

export class GoogleDriveNativeSourceAdapter implements KnowledgeSourceAdapter<Readonly<{ documentId: string }>> {
  private readonly reader: GoogleDriveNativeReader;
  constructor(reader: GoogleDriveNativeReader) { this.reader = reader; }

  async read(input: Readonly<{ documentId: string }>): Promise<KairosSourceSnapshot> {
    const documentId = input.documentId.trim();
    if (!documentId) throw new Error("Kairos Google Drive source requires documentId");
    const source = await this.reader.readDocument(documentId);
    if (source.documentId !== documentId) throw new Error("Kairos Google Drive adapter source identity mismatch");
    if (!source.revisionId.trim()) throw new Error("Kairos Google Drive adapter requires revisionId");
    return Object.freeze({
      sourceKey: `gdrive:${source.documentId}`,
      sourceType: "GOOGLE_DRIVE" as const,
      canonicalPointer: `https://docs.google.com/document/d/${source.documentId}`,
      title: source.title,
      revisionKey: source.revisionId,
      observedAt: source.observedAt,
      nativeText: source.nativeText,
      nativeContentType: "GOOGLE_DOC" as const,
      metadata: Object.freeze({ documentId: source.documentId, mimeType: source.mimeType }),
    });
  }
}

export type GitHubNativeFile = Readonly<{
  repository: string;
  path: string;
  ref: string;
  blobSha: string;
  observedAt: string;
  text?: string;
}>;

export interface GitHubNativeReader {
  readFile(input: Readonly<{ repository: string; path: string; ref: string }>): Promise<GitHubNativeFile>;
}

function githubContentType(path: string): KairosNativeContentType {
  const lower = path.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".mdx")) return "MARKDOWN";
  if (lower.endsWith(".json") || lower.endsWith(".jsonc")) return "JSON";
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "YAML";
  if (lower.endsWith(".sql")) return "SQL";
  if (/\.(?:ts|tsx|js|jsx|mjs|cjs|py|java|go|rs|rb|php|cs|cpp|c|h)$/i.test(lower)) return "SOURCE";
  return "TEXT";
}

export class GitHubNativeSourceAdapter implements KnowledgeSourceAdapter<Readonly<{ repository: string; path: string; ref: string }>> {
  private readonly reader: GitHubNativeReader;
  constructor(reader: GitHubNativeReader) { this.reader = reader; }

  async read(input: Readonly<{ repository: string; path: string; ref: string }>): Promise<KairosSourceSnapshot> {
    const repository = input.repository.trim();
    const path = input.path.replace(/^\/+/, "").trim();
    const ref = input.ref.trim();
    if (!repository || !path || !ref) throw new Error("Kairos GitHub source requires repository, path and ref");
    const source = await this.reader.readFile({ repository, path, ref });
    if (source.repository !== repository || source.path !== path || source.ref !== ref) {
      throw new Error("Kairos GitHub adapter source identity mismatch");
    }
    if (!/^[0-9a-f]{40}$/i.test(source.blobSha)) throw new Error("Kairos GitHub adapter requires exact blob SHA");
    return Object.freeze({
      sourceKey: `github:${repository}:${path}`,
      sourceType: "GITHUB" as const,
      canonicalPointer: `https://github.com/${repository}/blob/${ref}/${path}`,
      title: path.split("/").pop() ?? path,
      revisionKey: source.blobSha.toLowerCase(),
      observedAt: source.observedAt,
      nativeText: source.text,
      nativeContentType: githubContentType(path),
      metadata: Object.freeze({ repository, path, ref, blobSha: source.blobSha.toLowerCase() }),
    });
  }
}
