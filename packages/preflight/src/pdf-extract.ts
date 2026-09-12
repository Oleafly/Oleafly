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

function pushMarkedScope(scopes: MarkedScope[], record: Record<string, unknown>): void {
  const tag = typeof record.tag === "string" ? record.tag : null;
  const id = typeof record.id === "string" ? record.id : null;
  const parent = scopes.at(-1);
  scopes.push({
    artifact: (parent?.artifact ?? false) || tag === "Artifact",
    mcid: id ?? parent?.mcid ?? null,
  });
}

function countRun(
  counts: RunCounts,
  scope: MarkedScope | undefined,
  record: Record<string, unknown>,
  structIds: ReadonlySet<string>,
): void {
  if (typeof record.str !== "string" || !record.str.trim()) return;
  if (scope?.artifact) {
    counts.artifact++;
    return;
  }
  if (scope?.mcid && structIds.has(scope.mcid)) counts.tagged++;
  else counts.untagged++;
}

function countTextRuns(items: readonly unknown[], structIds: ReadonlySet<string>): RunCounts {
  const scopes: MarkedScope[] = [];
  const counts: RunCounts = { tagged: 0, untagged: 0, artifact: 0 };
  for (const item of items) {
    const record = recordOf(item);
    if (!record) continue;
    const type = typeof record.type === "string" ? record.type : null;
    if (type === "beginMarkedContent" || type === "beginMarkedContentProps") {
      pushMarkedScope(scopes, record);
      continue;
    }
    if (type === "endMarkedContent") {
      scopes.pop();
      continue;
    }
    countRun(counts, scopes.at(-1), record, structIds);
  }
  return counts;
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
  const last = carried.children.at(-1);
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

function normStructChildren(raw: readonly unknown[], ids: string[], children: StructNode[]): void {
  for (const child of raw) {
    const leaf = recordOf(child);
    if (leaf && typeof leaf.type === "string") {
      if (typeof leaf.id === "string" && leaf.id) ids.push(leaf.id);
      continue;
    }
    const normalized = normStruct(child);
    if (normalized) children.push(normalized);
  }
}

function taggedState(
  hasStructChildren: boolean,
  markInfoStatus: PdfExtractionStatus["markInfo"],
  markedFlag: boolean | null,
  structureStatus: PdfExtractionStatus["structure"],
): boolean | null {
  if (hasStructChildren) return true;
  if (markInfoStatus === "ok") return markedFlag === true;
  if (structureStatus === "ok") return false;
  return null;
}

function normStruct(node: unknown): StructNode | null {
  const record = recordOf(node);
  if (!record) return null;
  if (typeof record.type === "string") return null;
  const ids: string[] = [];
  const children: StructNode[] = [];
  if (Array.isArray(record.children)) {
    normStructChildren(record.children, ids, children);
  }
  return {
    role: typeof record.role === "string" ? record.role : "",
    alt: typeof record.alt === "string" ? record.alt : null,
    lang: typeof record.lang === "string" ? record.lang : null,
    ...(ids.length > 0 ? { ids } : {}),
    children,
  };
}

type PdfDocument = Awaited<pdfjsLib.PDFDocumentLoadingTask["promise"]>;
type PdfPage = Awaited<ReturnType<PdfDocument["getPage"]>>;
type PdfAnnotations = Awaited<ReturnType<PdfPage["getAnnotations"]>>;
type PdfTextItems = Awaited<ReturnType<PdfPage["getTextContent"]>>["items"];

interface PageScan {
  pages: PositionedText[][];
  pageText: string[];
  structRoots: StructNode[];
  textRuns: PdfExtract["textRuns"];
  links: PdfUaFacts["links"];
  structureFailedPages: number[];
  pageFacts: PdfFacts["pages"];
  linkCount: number;
  formFieldCount: number;
  fontFacts: Map<string, boolean | null>;
  inspectedFontIds: Set<string>;
}

function createPageScan(): PageScan {
  return {
    pages: [],
    pageText: [],
    structRoots: [],
    textRuns: [],
    links: [],
    structureFailedPages: [],
    pageFacts: [],
    linkCount: 0,
    formFieldCount: 0,
    fontFacts: new Map(),
    inspectedFontIds: new Set(),
  };
}

async function readPageStructTree(
  page: PdfPage,
  pageNumber: number,
  scan: PageScan,
): Promise<{ pageStruct: StructNode | null; structureRead: boolean }> {
  try {
    const tree: unknown = await page.getStructTree();
    const pageStruct = tree ? normStruct(tree) : null;
    if (pageStruct) scan.structRoots.push(pageStruct);
    return { pageStruct, structureRead: true };
  } catch {
    scan.structureFailedPages.push(pageNumber);
    return { pageStruct: null, structureRead: false };
  }
}

function collectAnnotationFacts(annotations: PdfAnnotations, scan: PageScan): void {
  for (const annotation of annotations) {
    if (annotation.subtype === "Link") {
      scan.linkCount++;
      const contents = recordOf(annotation.contentsObj)?.str;
      scan.links.push({ hasContents: typeof contents === "string" && contents.trim().length > 0 });
    }
    if (annotation.subtype === "Widget") scan.formFieldCount++;
  }
}

function readCommonFont(
  page: PdfPage,
  fontId: string,
): { name: string; embedded: boolean | null } {
  let embedded: boolean | null = null;
  let name = fontId;
  try {
    const font = page.commonObjs.get(fontId) as {
      name?: unknown;
      data?: unknown;
      missingFile?: unknown;
    };
    if (typeof font.name === "string" && font.name.trim()) name = font.name.trim();
    if (font.data instanceof Uint8Array || font.data instanceof ArrayBuffer) embedded = true;
    else if (font.missingFile === true) embedded = false;
  } catch {
  }
  return { name, embedded };
}

function collectFontFacts(page: PdfPage, items: PdfTextItems, scan: PageScan): void {
  for (const item of items) {
    if (!("str" in item) || scan.inspectedFontIds.has(item.fontName)) continue;
    scan.inspectedFontIds.add(item.fontName);
    const font = readCommonFont(page, item.fontName);
    scan.fontFacts.set(font.name, font.embedded);
  }
}

async function scanPage(page: PdfPage, pageNumber: number, scan: PageScan): Promise<void> {
  const { pageStruct, structureRead } = await readPageStructTree(page, pageNumber, scan);

  const [marked, annotations] = await Promise.all([
    page.getTextContent({ includeMarkedContent: true }),
    page.getAnnotations({ intent: "display" }),
  ]);
  if (structureRead) {
    const structIds = pageStruct ? collectStructIds(pageStruct, new Set()) : new Set<string>();
    const runs = countTextRuns(marked.items, structIds);
    scan.textRuns.push({ page: pageNumber, ...runs });
  }
  const tc = { items: marked.items.filter((item) => "str" in item) };
  const viewport = page.getViewport({ scale: 1 });
  scan.pageFacts.push({ width: viewport.width, height: viewport.height, rotation: viewport.rotation });
  collectAnnotationFacts(annotations, scan);
  const reconstructed = reconstructPdfPageText(tc.items);
  collectFontFacts(page, tc.items, scan);
  scan.pages.push(reconstructed.items);
  scan.pageText.push(reconstructed.text);
}

function cleanupPage(page: PdfPage): void {
  try {
    page.cleanup();
  } catch {
  }
}

interface MetadataFacts {
  lang: string | null;
  title: string | null;
  xmpTitle: string | null;
  infoTitle: string | null;
  uaPart: number | null;
  uaRev: string | null;
  author: string | null;
  creator: string | null;
  producer: string | null;
  status: PdfExtractionStatus["metadata"];
}

async function readMetadataFacts(doc: PdfDocument): Promise<MetadataFacts> {
  const facts: MetadataFacts = {
    lang: null,
    title: null,
    xmpTitle: null,
    infoTitle: null,
    uaPart: null,
    uaRev: null,
    author: null,
    creator: null,
    producer: null,
    status: "ok",
  };
  try {
    const metadata = await doc.getMetadata();
    facts.infoTitle = stringProperty(metadata.info, "Title");
    facts.xmpTitle = xmpValue(metadata.metadata, "dc:title");
    facts.title = facts.xmpTitle ?? facts.infoTitle;
    facts.lang = stringProperty(metadata.info, "Language") ?? stringProperty(metadata.info, "Lang");
    facts.uaPart = numberFrom(xmpValue(metadata.metadata, "pdfuaid:part")) ?? uaPartFromRaw(xmpRaw(metadata.metadata));
    facts.uaRev = xmpValue(metadata.metadata, "pdfuaid:rev");
    try {
      facts.author = stringProperty(metadata.info, "Author") ?? xmpValue(metadata.metadata, "dc:creator");
      facts.creator = stringProperty(metadata.info, "Creator");
      facts.producer = stringProperty(metadata.info, "Producer");
    } catch {
    }
  } catch {
    facts.status = "failed";
  }
  return facts;
}

async function readMarkInfoFacts(doc: PdfDocument): Promise<{
  markedFlag: boolean | null;
  suspects: boolean | null;
  status: PdfExtractionStatus["markInfo"];
}> {
  try {
    const markInfo = await doc.getMarkInfo();
    return {
      markedFlag: markInfo?.Marked === true,
      suspects: markInfo ? markInfo.Suspects === true : null,
      status: "ok",
    };
  } catch {
    return { markedFlag: null, suspects: null, status: "failed" };
  }
}

async function readDisplayDocTitle(doc: PdfDocument): Promise<boolean | null> {
  try {
    const preferences = await doc.getViewerPreferences();
    const declared: unknown = preferences?.get("DisplayDocTitle");
    return typeof declared === "boolean" ? declared : false;
  } catch {
    return null;
  }
}

async function readOutlineCount(doc: PdfDocument): Promise<number> {
  try {
    const outline = await doc.getOutline();
    const count = (items: NonNullable<typeof outline>): number =>
      items.reduce((total, item) => total + 1 + count(item.items), 0);
    return outline ? count(outline) : 0;
  } catch {
    return 0;
  }
}

async function readAttachmentCount(doc: PdfDocument): Promise<number> {
  try {
    return Object.keys((await doc.getAttachments()) ?? {}).length;
  } catch {
    return 0;
  }
}

async function readRestricted(doc: PdfDocument): Promise<boolean | null> {
  try {
    return (await doc.getPermissions()) !== null;
  } catch {
    return null;
  }
}

async function destroyLoadingTask(task: pdfjsLib.PDFDocumentLoadingTask): Promise<void> {
  try {
    await task.destroy();
  } catch {
  }
}

export async function extractForPreflight(bytes: Uint8Array): Promise<PdfExtract> {
  const header = new TextDecoder("ascii").decode(bytes.slice(0, 16));
  const version = /%PDF-(\d+\.\d+)/.exec(header)?.[1] ?? null;
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
  try {
    const doc = await loadingTask.promise;

    const scan = createPageScan();
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      try {
        await scanPage(page, p, scan);
      } finally {
        cleanupPage(page);
      }
    }

    const metadata = await readMetadataFacts(doc);
    const markInfo = await readMarkInfoFacts(doc);
    const displayDocTitle = await readDisplayDocTitle(doc);

    const structChildren = scan.structRoots.reduce<StructNode[]>(
      (merged, root) => mergeStructNodes(merged, root.children, root.role, merged.length),
      [],
    );
    const structureStatus: PdfExtractionStatus["structure"] =
      scan.structureFailedPages.length > 0 ? "failed" : "ok";
    const tagged = taggedState(
      structChildren.length > 0,
      markInfo.status,
      markInfo.markedFlag,
      structureStatus,
    );
    const ua: PdfUaFacts = {
      displayDocTitle,
      suspects: markInfo.suspects,
      xmpTitle: metadata.xmpTitle,
      infoTitle: metadata.infoTitle,
      uaPart: metadata.uaPart,
      uaRev: metadata.uaRev,
      taggedTextRuns: scan.textRuns.reduce((total, page) => total + page.tagged, 0),
      untaggedTextRuns: scan.textRuns.reduce((total, page) => total + page.untagged, 0),
      artifactTextRuns: scan.textRuns.reduce((total, page) => total + page.artifact, 0),
      links: scan.links,
    };
    const struct: StructDoc = {
      root: structChildren.length
        ? { role: "Document", alt: null, lang: metadata.lang, children: structChildren }
        : null,
      tagged,
      ua,
    };
    const extraction: PdfExtractionStatus = {
      metadata: metadata.status,
      markInfo: markInfo.status,
      structure: structureStatus,
      structureFailedPages: scan.structureFailedPages,
    };

    const outlineCount = await readOutlineCount(doc);
    const attachmentCount = await readAttachmentCount(doc);
    const restricted = await readRestricted(doc);
    const facts: PdfFacts = {
      version,
      pageCount: doc.numPages,
      pages: scan.pageFacts,
      outlineCount,
      linkCount: scan.linkCount,
      attachmentCount,
      formFieldCount: scan.formFieldCount,
      restricted,
      author: metadata.author,
      creator: metadata.creator,
      producer: metadata.producer,
      fonts: [...scan.fontFacts].map(([name, embedded]) => ({ name, embedded })),
    };

    return {
      pages: scan.pages,
      pageText: scan.pageText,
      lang: metadata.lang,
      title: metadata.title,
      tagged,
      struct,
      extraction,
      facts,
      ua,
      textRuns: scan.textRuns,
    };
  } finally {
    await destroyLoadingTask(loadingTask);
  }
}
