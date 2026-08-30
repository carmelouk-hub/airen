import type { KairosNativeContentType } from "./source-adapters.ts";

export type ParsedKnowledgeUnit = Readonly<{
  ordinal: number;
  unitType: "SECTION" | "PARAGRAPH" | "CODE" | "STRUCTURED";
  heading?: string;
  bodyText: string;
  sourceAnchor: string;
}>;

export type NativeParseResult = Readonly<{
  parserKind: string;
  units: readonly ParsedKnowledgeUnit[];
}>;

export interface NativeKnowledgeParser {
  readonly parserKind: string;
  supports(contentType: KairosNativeContentType): boolean;
  parse(text: string): NativeParseResult;
}

function normalizedLines(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n");
}

class MarkdownKnowledgeParser implements NativeKnowledgeParser {
  readonly parserKind = "native-markdown-v1";
  supports(contentType: KairosNativeContentType): boolean { return contentType === "MARKDOWN" || contentType === "GOOGLE_DOC"; }
  parse(text: string): NativeParseResult {
    const lines = normalizedLines(text);
    const units: ParsedKnowledgeUnit[] = [];
    let heading: string | undefined;
    let body: string[] = [];
    let startLine = 1;

    const flush = (endLine: number) => {
      const bodyText = body.join("\n").trim();
      if (!heading && !bodyText) return;
      units.push(Object.freeze({
        ordinal: units.length,
        unitType: heading ? "SECTION" : "PARAGRAPH",
        ...(heading ? { heading } : {}),
        bodyText,
        sourceAnchor: `lines:${startLine}-${Math.max(startLine,endLine)}`,
      }));
    };

    for (let i = 0; i < lines.length; i += 1) {
      const match = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[i]);
      if (match) {
        flush(i);
        heading = match[2].trim();
        body = [];
        startLine = i + 1;
      } else {
        body.push(lines[i]);
      }
    }
    flush(lines.length);
    return Object.freeze({ parserKind: this.parserKind, units: Object.freeze(units) });
  }
}

class JsonKnowledgeParser implements NativeKnowledgeParser {
  readonly parserKind = "native-json-v1";
  supports(contentType: KairosNativeContentType): boolean { return contentType === "JSON"; }
  parse(text: string): NativeParseResult {
    const value = JSON.parse(text) as unknown;
    const units: ParsedKnowledgeUnit[] = [];
    const visit = (node: unknown, path: string) => {
      if (node !== null && typeof node === "object") {
        if (Array.isArray(node)) {
          node.forEach((entry,index)=>visit(entry,`${path}[${index}]`));
          if (!node.length) units.push(Object.freeze({ ordinal: units.length, unitType: "STRUCTURED", bodyText: "[]", sourceAnchor: path }));
          return;
        }
        const entries = Object.entries(node as Record<string, unknown>).sort(([a],[b])=>a.localeCompare(b));
        entries.forEach(([key,entry])=>visit(entry,path ? `${path}.${key}` : key));
        if (!entries.length) units.push(Object.freeze({ ordinal: units.length, unitType: "STRUCTURED", bodyText: "{}", sourceAnchor: path || "$" }));
        return;
      }
      units.push(Object.freeze({
        ordinal: units.length,
        unitType: "STRUCTURED",
        bodyText: node === null ? "null" : String(node),
        sourceAnchor: path || "$",
      }));
    };
    visit(value,"$");
    return Object.freeze({ parserKind: this.parserKind, units: Object.freeze(units) });
  }
}

class LineKnowledgeParser implements NativeKnowledgeParser {
  readonly parserKind = "native-line-v1";
  supports(contentType: KairosNativeContentType): boolean { return ["TEXT","YAML","SQL","SOURCE"].includes(contentType); }
  parse(text: string): NativeParseResult {
    const lines = normalizedLines(text);
    const units: ParsedKnowledgeUnit[] = [];
    let block: string[] = [];
    let startLine = 1;
    const flush = (endLine: number) => {
      const bodyText = block.join("\n").trim();
      if (bodyText) units.push(Object.freeze({
        ordinal: units.length,
        unitType: "CODE",
        bodyText,
        sourceAnchor: `lines:${startLine}-${Math.max(startLine,endLine)}`,
      }));
      block = [];
    };
    for (let i=0;i<lines.length;i+=1) {
      if (!lines[i].trim()) {
        flush(i);
        startLine=i+2;
      } else {
        if (!block.length) startLine=i+1;
        block.push(lines[i]);
      }
    }
    flush(lines.length);
    return Object.freeze({ parserKind: this.parserKind, units: Object.freeze(units) });
  }
}

export class NativeParserRegistry {
  private readonly parsers: readonly NativeKnowledgeParser[];
  constructor(parsers: readonly NativeKnowledgeParser[] = [new JsonKnowledgeParser(),new MarkdownKnowledgeParser(),new LineKnowledgeParser()]) {
    this.parsers = Object.freeze([...parsers]);
  }
  parse(contentType: KairosNativeContentType,text: string): NativeParseResult {
    const parser=this.parsers.find((candidate)=>candidate.supports(contentType));
    if(!parser)throw new Error(`No Kairos native parser registered for ${contentType}`);
    return parser.parse(text);
  }
}
