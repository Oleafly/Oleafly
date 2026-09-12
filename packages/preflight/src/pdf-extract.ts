import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "@oleafly/preview/pdf.worker?worker&url";
import { reconstructPdfPageText } from "./pdf-text";
import type { PdfExtractionStatus, PdfFacts, PositionedText } from "./types";
import type { PdfUaFacts, StructNode, StructDoc } from "./structure";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export interface PdfExtract {
  pages: PositionedText[][];
  pageText: string[];
  lang: string | null;
  title: string | null;
  tagged: boolean | null;
  struct: StructDoc;
  extraction: PdfExtractionStatus;
  facts: PdfFacts;
  ua: PdfUaFacts;
  textRuns: { page: number; tagged: number; untagged: number; artifact: number }[];
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function stringProperty(value: unknown, key: string): string | null {
  const candidate = recordOf(value)?.[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function flattenText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    const parts = value.map(flattenText).filter((part): part is string => part !== null);
    return parts.length > 0 ? parts.join(", ") : null;
  }
  return null;
}

function xmpValue(metadata: unknown, key: string): string | null {
  const source = recordOf(metadata);
  const get = source?.get;
  if (typeof get !== "function") return null;
  try {
    return flattenText((get as (name: string) => unknown).call(source, key));
  } catch {
    return null;
  }
}

function xmpRaw(metadata: unknown): string | null {
  const source = recordOf(metadata);
  const getRaw = source?.getRaw;
  if (typeof getRaw !== "function") return null;
  try {
    const raw = (getRaw as () => unknown).call(source);
    return typeof raw === "string" ? raw : null;
  } catch {
    return null;
  }
}

function numberFrom(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function uaPartFromRaw(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const match = /<pdfuaid:part>\s*(\d+)\s*<|pdfuaid:part\s*=\s*"(\d+)"/.exec(raw);
  const digits = match?.[1] ?? match?.[2];
  return digits ? Number.parseInt(digits, 10) : null;
}

interface RunCounts {
  tagged: number;
  untagged: number;
  artifact: number;
}

interface MarkedScope {
  artifact: boolean;
  mcid: string | null;
}

function countTextRuns(items: readonly unknown[], structIds: ReadonlySet<string>): RunCounts {
  const scopes: MarkedScope[] = [];
  let tagged = 0;
  let untagged = 0;
  let artifact = 0;
  for (const item of items) {
    const record = recordOf(item);
    if (!record) continue;
    const type = typeof record.type === "string" ? record.type : null;
    if (type === "beginMarkedContent" || type === "beginMarkedContentProps") {
      const tag = typeof record.tag === "string" ? record.tag : null;
      const id = typeof record.id === "string" ? record.id : null;
      const parent = scopes[scopes.length - 1];
      scopes.push({
        artifact: (parent?.artifact ?? false) || tag === "Artifact",
        mcid: id ?? parent?.mcid ?? null,
      });
      continue;
    }
    if (type === "endMarkedContent") {
      scopes.pop();
      continue;
    }
    if (typeof record.str !== "string" || !record.str.trim()) continue;
    const scope = scopes[scopes.length - 1];
    if (scope?.artifact) {
      artifact++;
      continue;
    }
    if (scope?.mcid && structIds.has(scope.mcid)) tagged++;
    else untagged++;
  }
  return { tagged, untagged, artifact };
}

function collectStructIds(node: StructNode, into: Set<string>): Set<string> {
  for (const id of node.ids ?? []) into.add(id);
  for (const child of node.children) collectStructIds(child, into);
  return into;
}

function sharesStructId(node: StructNode, ids: ReadonlySet<string>): boolean {
  for (const id of collectStructIds(node, new Set())) {
    if (ids.has(id)) return true;
  }
  return false;
}

const REPEATED_ON_EVERY_PAGE = new Set([
  "Table",
  "THead",
  "TBody",
  "TFoot",
  "TR",
  "L",
  "LI",
  "LBody",
]);

function sameElement(left: StructNode, right: StructNode): boolean {
  return (
    left.role === right.role &&
    (left.lang ?? null) === (right.lang ?? null) &&
    (left.alt ?? null) === (right.alt ?? null)
  );
}

function repeatsAcrossPages(carried: StructNode, node: StructNode): boolean {
  let carriedContent = false;
  let incomingContent = false;
  const matches = (left: StructNode, right: StructNode): boolean => {
    if (!sameElement(left, right)) return false;
    const drawnBefore = (left.ids?.length ?? 0) > 0;
    const drawnNow = (right.ids?.length ?? 0) > 0;
    if (drawnBefore && drawnNow) return false;
    carriedContent ||= drawnBefore;
    incomingContent ||= drawnNow;
    if (left.children.length !== right.children.length) return false;
    return left.children.every((child, index) => matches(child, right.children[index]));
  };
  return matches(carried, node) && carriedContent && incomingContent;
}

function continuesElement(carried: StructNode, node: StructNode): boolean {
  if (!sameElement(carried, node)) return false;
  if (REPEATED_ON_EVERY_PAGE.has(node.role)) return repeatsAcrossPages(carried, node);
  const last = carried.children[carried.children.length - 1];
  const first = node.children[0];
  return last !== undefined && first !== undefined && continuesElement(last, first);
}

function twinBySharedIds(
  target: readonly StructNode[],
  carried: number,
  node: StructNode,
  ids: ReadonlySet<string>,
): StructNode | undefined {
  for (let index = 0; index < carried; index++) {
    const candidate = target[index];
    if (candidate.role === node.role && sharesStructId(candidate, ids)) return candidate;
  }
  return undefined;
}

function mergeStructNodes(
  target: StructNode[],
  incoming: readonly StructNode[],
  parentRole: string,
  carried: number,
): StructNode[] {
  const repeated = REPEATED_ON_EVERY_PAGE.has(parentRole);
  for (let index = 0; index < incoming.length; index++) {
    const node = incoming[index];
    const ids = collectStructIds(node, new Set());
    let twin = ids.size > 0 ? twinBySharedIds(target, carried, node, ids) : undefined;
    if (!twin && repeated && index < carried && sameElement(target[index], node)) {
      twin = target[index];
    }
    if (!twin && index === 0 && carried > 0 && continuesElement(target[carried - 1], node)) {
      twin = target[carried - 1];
    }
    if (!twin) {
      target.push(node);
      continue;
    }
    const ownIds = [...new Set([...(twin.ids ?? []), ...(node.ids ?? [])])];
    if (ownIds.length > 0) twin.ids = ownIds;
    twin.children = mergeStructNodes(twin.children, node.children, twin.role, twin.children.length);
  }
  return target;
}

function normStruct(node: unknown): StructNode | null {
  const record = recordOf(node);
  if (!record) return null;
  if (typeof record.type === "string") return null;
  const ids: string[] = [];
  const children: StructNode[] = [];
  if (Array.isArray(record.children)) {
    for (const child of record.children) {
      const leaf = recordOf(child);
      if (leaf && typeof leaf.type === "string") {
        if (typeof leaf.id === "string" && leaf.id) ids.push(leaf.id);
        continue;
      }
      const normalized = normStruct(child);
      if (normalized) children.push(normalized);
    }
  }
  return {
    role: typeof record.role === "string" ? record.role : "",
    alt: typeof record.alt === "string" ? record.alt : null,
    lang: typeof record.lang === "string" ? record.lang : null,
    ...(ids.length > 0 ? { ids } : {}),
    children,
  };
}

export async function extractForPreflight(bytes: Uint8Array): Promise<PdfExtract> {
  const header = new TextDecoder("ascii").decode(bytes.slice(0, 16));
  const version = /%PDF-(\d+\.\d+)/.exec(header)?.[1] ?? null;
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
  try {
    const doc = await loadingTask.promise;

    const pages: PositionedText[][] = [];
    const pageText: string[] = [];
    const structRoots: StructNode[] = [];
    const textRuns: PdfExtract["textRuns"] = [];
    const links: PdfUaFacts["links"] = [];
    const structureFailedPages: number[] = [];
    const pageFacts: PdfFacts["pages"] = [];
    let linkCount = 0;
    let formFieldCount = 0;
    const fontFacts = new Map<string, boolean | null>();
    const inspectedFontIds = new Set<string>();
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      try {
        let pageStruct: StructNode | null = null;
        let structureRead = true;
        try {
          const tree: unknown = await page.getStructTree();
          pageStruct = tree ? normStruct(tree) : null;
          if (pageStruct) structRoots.push(pageStruct);
        } catch {
          structureRead = false;
          structureFailedPages.push(p);
        }

        const [marked, annotations] = await Promise.all([
          page.getTextContent({ includeMarkedContent: true }),
          page.getAnnotations({ intent: "display" }),
        ]);
        if (structureRead) {
          const structIds = pageStruct ? collectStructIds(pageStruct, new Set()) : new Set<string>();
          const runs = countTextRuns(marked.items, structIds);
          textRuns.push({ page: p, ...runs });
        }
        const tc = { items: marked.items.filter((item) => "str" in item) };
        const viewport = page.getViewport({ scale: 1 });
        pageFacts.push({ width: viewport.width, height: viewport.height, rotation: viewport.rotation });
        for (const annotation of annotations) {
          if (annotation.subtype === "Link") {
            linkCount++;
            const contents = recordOf(annotation.contentsObj)?.str;
            links.push({ hasContents: typeof contents === "string" && contents.trim().length > 0 });
          }
          if (annotation.subtype === "Widget") formFieldCount++;
        }
        const reconstructed = reconstructPdfPageText(tc.items);
        for (const item of tc.items) {
          if (!("str" in item) || inspectedFontIds.has(item.fontName)) continue;
          inspectedFontIds.add(item.fontName);
          let embedded: boolean | null = null;
          let name = item.fontName;
          try {
            const font = page.commonObjs.get(item.fontName) as {
              name?: unknown;
              data?: unknown;
              missingFile?: unknown;
            };
            if (typeof font.name === "string" && font.name.trim()) name = font.name.trim();
            if (font.data instanceof Uint8Array || font.data instanceof ArrayBuffer) embedded = true;
            else if (font.missingFile === true) embedded = false;
          } catch {
          }
          fontFacts.set(name, embedded);
        }
        pages.push(reconstructed.items);
        pageText.push(reconstructed.text);
      } finally {
        try {
          page.cleanup();
        } catch {
        }
      }
    }

    let lang: string | null = null;
    let title: string | null = null;
    let xmpTitle: string | null = null;
    let infoTitle: string | null = null;
    let uaPart: number | null = null;
    let uaRev: string | null = null;
    let markedFlag: boolean | null = null;
    let suspects: boolean | null = null;
    let displayDocTitle: boolean | null = null;
    let author: string | null = null;
    let creator: string | null = null;
    let producer: string | null = null;
    let metadataStatus: PdfExtractionStatus["metadata"] = "ok";
    let markInfoStatus: PdfExtractionStatus["markInfo"] = "ok";
    try {
      const metadata = await doc.getMetadata();
      infoTitle = stringProperty(metadata.info, "Title");
      xmpTitle = xmpValue(metadata.metadata, "dc:title");
      title = xmpTitle ?? infoTitle;
      lang = stringProperty(metadata.info, "Language") ?? stringProperty(metadata.info, "Lang");
      uaPart = numberFrom(xmpValue(metadata.metadata, "pdfuaid:part")) ?? uaPartFromRaw(xmpRaw(metadata.metadata));
      uaRev = xmpValue(metadata.metadata, "pdfuaid:rev");
      try {
        author = stringProperty(metadata.info, "Author") ?? xmpValue(metadata.metadata, "dc:creator");
        creator = stringProperty(metadata.info, "Creator");
        producer = stringProperty(metadata.info, "Producer");
      } catch {
      }
    } catch {
      metadataStatus = "failed";
    }
    try {
      const markInfo = await doc.getMarkInfo();
      markedFlag = markInfo?.Marked === true;
      suspects = markInfo ? markInfo.Suspects === true : null;
    } catch {
      markInfoStatus = "failed";
    }
    try {
      const preferences = await doc.getViewerPreferences();
      const declared: unknown = preferences?.get("DisplayDocTitle");
      displayDocTitle = typeof declared === "boolean" ? declared : false;
    } catch {
      displayDocTitle = null;
    }

    const structChildren = structRoots.reduce<StructNode[]>(
      (merged, root) => mergeStructNodes(merged, root.children, root.role, merged.length),
      [],
    );
    const structureStatus: PdfExtractionStatus["structure"] =
      structureFailedPages.length > 0 ? "failed" : "ok";
    const tagged =
      structChildren.length > 0
        ? true
        : markInfoStatus === "ok"
          ? markedFlag === true
          : structureStatus === "ok"
            ? false
            : null;
    const ua: PdfUaFacts = {
      displayDocTitle,
      suspects,
      xmpTitle,
      infoTitle,
      uaPart,
      uaRev,
      taggedTextRuns: textRuns.reduce((total, page) => total + page.tagged, 0),
      untaggedTextRuns: textRuns.reduce((total, page) => total + page.untagged, 0),
      artifactTextRuns: textRuns.reduce((total, page) => total + page.artifact, 0),
      links,
    };
    const struct: StructDoc = {
      root: structChildren.length ? { role: "Document", alt: null, lang, children: structChildren } : null,
      tagged,
      ua,
    };
    const extraction: PdfExtractionStatus = {
      metadata: metadataStatus,
      markInfo: markInfoStatus,
      structure: structureStatus,
      structureFailedPages,
    };

    let outlineCount = 0;
    try {
      const outline = await doc.getOutline();
      const count = (items: NonNullable<typeof outline>): number =>
        items.reduce((total, item) => total + 1 + count(item.items), 0);
      outlineCount = outline ? count(outline) : 0;
    } catch {
    }
    let attachmentCount = 0;
    try {
      attachmentCount = Object.keys((await doc.getAttachments()) ?? {}).length;
    } catch {
    }
    let restricted: boolean | null = null;
    try {
      restricted = (await doc.getPermissions()) !== null;
    } catch {
    }
    const facts: PdfFacts = {
      version,
      pageCount: doc.numPages,
      pages: pageFacts,
      outlineCount,
      linkCount,
      attachmentCount,
      formFieldCount,
      restricted,
      author,
      creator,
      producer,
      fonts: [...fontFacts].map(([name, embedded]) => ({ name, embedded })),
    };

    return { pages, pageText, lang, title, tagged, struct, extraction, facts, ua, textRuns };
  } finally {
    try {
      await loadingTask.destroy();
    } catch {
    }
  }
}
