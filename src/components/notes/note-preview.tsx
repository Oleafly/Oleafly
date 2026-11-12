import "katex/dist/katex.min.css";
import { imageWidthPercent, imageWidthSuffix } from "@oleafly/wysiwyg";
import { AudioLines, Check, ImageOff, Play, SquareStack } from "lucide-react";
import { type CSSProperties, createContext, memo, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { defaultUrlTransform, type Components } from "react-markdown";
import { BlockFrame } from "@/components/ui/block-frame";
import { type MarkdownDocumentOptions, renderMarkdownDocument } from "@/components/ui/markdown-renderer";
import { RemoteImageNotice } from "@/components/ui/remote-image-notice";
import type { NotesHighlightColor } from "@/lib/notes-appearance";
import { allowRemoteImage, type RemoteImage, remoteImage, remoteImageAllowed, subscribeRemoteImages } from "@/lib/remote-image";
import { cn } from "@/lib/utils";
import { blockLabel, paintStillBlock } from "./block-views";
import { stripBlockIdMarkers } from "./note-block-ids";
import { noteBlockName } from "./note-blocks";
import { noteColorStyle } from "./note-icons";
import { HIGHLIGHT_CLOSE_TAG, highlightEnd, highlightTag } from "./note-highlight";
import { parseNoteLink } from "./note-link-format";
import { assetFragment, imageSource, noteMediaKind, VIDEO_PROVIDER_NAMES, videoEmbed } from "./note-path";
import { basename } from "@/lib/path-utils";

export const PREVIEW_SCALE = 0.28;
export const PREVIEW_BLOCKS = 64;
export const PREVIEW_BLOCK_TEXT = 600;
export const PREVIEW_TABLE = 6;

interface HastText {
  type: "text";
  value: string;
}

interface HastElement {
  type: "element";
  tagName: string;
  properties: Record<string, unknown>;
  children: HastNode[];
}

type HastNode = HastText | HastElement | { type: "comment" | "raw" | "doctype"; value?: string };

interface HastParent {
  children: HastNode[];
}

const BLOCK_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "pre", "table", "tr", "th", "td", "hr", "figure"]);
const TEXT_BLOCKS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "th", "td", "pre"]);
const MATH_CLASSES = new Set(["language-math", "math-inline", "math-display"]);
const DRAWN_BLOCK = "dataPreviewBlock";
const DRAWN_SOURCE = "dataPreviewSource";
const IMAGE_WIDTH = "dataWidthPercent";
const LITERAL_TAGS = new Set(["code", "pre"]);
const INLINE_NODE = "\uFFFC";

function isElement(node: HastNode): node is HastElement {
  return node.type === "element";
}

function classes(node: HastElement): string[] {
  const value = node.properties.className;
  return Array.isArray(value) ? value.filter((name): name is string => typeof name === "string") : [];
}

function textOf(node: HastNode): string {
  if (node.type === "text") return node.value;
  return isElement(node) ? node.children.map(textOf).join("") : "";
}

function highlight(children: HastNode[], color: NotesHighlightColor | null): HastElement {
  const properties: Record<string, unknown> = { className: ["note-highlight"] };
  if (color) properties.dataColor = color;
  return { type: "element", tagName: "mark", properties, children };
}

function rawValue(node: HastNode): string | null {
  return node.type === "raw" ? (node.value ?? "") : null;
}

function colorHighlights(children: HastNode[]): HastNode[] {
  const kept: HastNode[] = [];
  let index = 0;
  while (index < children.length) {
    const tag = rawValue(children[index]);
    const open = tag === null ? null : highlightTag(tag);
    let close = index + 1;
    while (open && close < children.length && rawValue(children[close]) !== HIGHLIGHT_CLOSE_TAG) close++;
    if (!open || open.length !== tag?.length || close <= index + 1 || close >= children.length) {
      kept.push(children[index]);
      index += 1;
    } else {
      kept.push(highlight(children.slice(index + 1, close), open.color));
      index = close + 1;
    }
  }
  return kept;
}

function nodesBetween(children: HastNode[], from: number, to: number): HastNode[] {
  const kept: HastNode[] = [];
  let offset = 0;
  for (const child of children) {
    const length = child.type === "text" ? child.value.length : 1;
    const start = Math.max(from - offset, 0);
    const end = Math.min(to - offset, length);
    if (end > start) kept.push(child.type === "text" ? { type: "text", value: child.value.slice(start, end) } : child);
    offset += length;
  }
  return kept;
}

function plainHighlights(children: HastNode[]): HastNode[] {
  const flat = children.map((child) => (child.type === "text" ? child.value : INLINE_NODE)).join("");
  const kept: HastNode[] = [];
  let from = 0;
  let at = flat.indexOf("==");
  while (at >= 0) {
    const close = highlightEnd(flat, at, flat.length);
    if (close < 0) {
      at = flat.indexOf("==", at + 1);
      continue;
    }
    kept.push(...nodesBetween(children, from, at), highlight(nodesBetween(children, at + 2, close), null));
    from = close + 2;
    at = flat.indexOf("==", from);
  }
  return from === 0 ? children : [...kept, ...nodesBetween(children, from, flat.length)];
}

function sizeImages(children: HastNode[]): void {
  children.forEach((child, index) => {
    const next = children[index + 1];
    if (!isElement(child) || child.tagName !== "img" || next?.type !== "text") return;
    const suffix = imageWidthSuffix(next.value);
    if (!suffix) return;
    child.properties[IMAGE_WIDTH] = suffix.width;
    next.value = next.value.slice(suffix.length);
  });
}

function noteInline(parent: HastParent): void {
  sizeImages(parent.children);
  parent.children = plainHighlights(colorHighlights(parent.children));
  for (const child of parent.children) {
    if (isElement(child) && !LITERAL_TAGS.has(child.tagName)) noteInline(child);
  }
}

function cutText(nodes: HastNode[], budget: { left: number }): HastNode[] {
  const kept: HastNode[] = [];
  for (const node of nodes) {
    if (budget.left <= 0) break;
    if (node.type === "text") {
      if (node.value.length > budget.left) {
        kept.push({ type: "text", value: `${node.value.slice(0, budget.left).trimEnd()}…` });
        budget.left = 0;
        break;
      }
      budget.left -= node.value.length;
    } else if (isElement(node) && !BLOCK_TAGS.has(node.tagName) && !classes(node).some((name) => MATH_CLASSES.has(name))) {
      node.children = cutText(node.children, budget);
    }
    kept.push(node);
  }
  return kept;
}

function drawnBlock(node: HastElement): HastElement | null {
  if (node.tagName !== "pre") return null;
  const code = node.children.find(isElement);
  const language = code ? classes(code).find((name) => name.startsWith("language-")) : undefined;
  const kind = language ? noteBlockName(language.slice("language-".length)) : undefined;
  if (!code || !kind) return null;
  return {
    type: "element",
    tagName: "div",
    properties: { [DRAWN_BLOCK]: kind, [DRAWN_SOURCE]: textOf(code).replace(/\n$/u, "") },
    children: [],
  };
}

function imageFigure(node: HastElement): HastElement | null {
  if (node.tagName !== "p") return null;
  const elements = node.children.filter(isElement);
  const loose = node.children.some((child) => child.type === "text" && child.value.trim() !== "");
  if (loose || elements.length !== 1 || elements[0].tagName !== "img") return null;
  return { type: "element", tagName: "figure", properties: { className: ["note-image"] }, children: [elements[0]] };
}

function trimTable(table: HastElement): void {
  let rows = 0;
  const visit = (parent: HastElement) => {
    parent.children = parent.children.filter((child) => {
      if (!isElement(child)) return true;
      if (child.tagName !== "tr") {
        visit(child);
        return true;
      }
      rows += 1;
      if (rows > PREVIEW_TABLE) return false;
      let cells = 0;
      child.children = child.children.filter((cell) => !isElement(cell) || ++cells <= PREVIEW_TABLE);
      return true;
    });
  };
  visit(table);
}

interface PruneState {
  blocks: number;
  full?: boolean;
}

function prunedElement(child: HastElement, state: PruneState): HastElement {
  const node = drawnBlock(child) ?? imageFigure(child) ?? child;
  const drawn = DRAWN_BLOCK in node.properties;
  if (drawn || BLOCK_TAGS.has(node.tagName)) state.blocks += 1;
  if (!state.full && node.tagName === "table") trimTable(node);
  if (!state.full && TEXT_BLOCKS.has(node.tagName)) node.children = cutText(node.children, { left: PREVIEW_BLOCK_TEXT });
  if (!drawn) prune(node, state);
  return node;
}

function prune(parent: HastParent, state: PruneState): void {
  const kept: HastNode[] = [];
  for (const child of parent.children) {
    if (!isElement(child)) {
      kept.push(child);
      continue;
    }
    if (!state.full && state.blocks >= PREVIEW_BLOCKS) break;
    kept.push(prunedElement(child, state));
  }
  parent.children = kept;
}

export function trimPreviewTree() {
  return (tree: HastParent) => {
    noteInline(tree);
    prune(tree, { blocks: 0 });
  };
}

interface PreviewNote {
  noteId: string;
  resolve?: (noteId: string, path: string) => Promise<string | null>;
  still?: boolean;
}

const PreviewNoteContext = createContext<PreviewNote | null>(null);

function MissingImage() {
  return (
    <span data-preview-missing className="flex h-40 w-full items-center justify-center rounded-[0.625rem] bg-muted text-muted-foreground">
      <ImageOff aria-hidden className="size-12" />
    </span>
  );
}

function HeldImage({ remote, alt, still, style }: Readonly<{ remote: RemoteImage; alt?: string; still: boolean; style?: CSSProperties }>) {
  const loaded = useSyncExternalStore(
    subscribeRemoteImages,
    () => remoteImageAllowed(remote.url),
    () => false,
  );
  if (loaded) return <img src={remote.url} alt={alt ?? ""} draggable={false} style={style} />;
  return <RemoteImageNotice host={remote.host} alt={alt} onLoad={still ? undefined : () => allowRemoteImage(remote.url)} />;
}

function mediaName(src: string): string {
  const embed = videoEmbed(src);
  if (embed) return VIDEO_PROVIDER_NAMES[embed.provider];
  const source = imageSource(src);
  return basename(source && "path" in source ? assetFragment(source.path).file : src) || src;
}

function PreviewMedia({ src, kind }: Readonly<{ src: string; kind: "audio" | "video" }>) {
  const Icon = kind === "video" ? Play : AudioLines;
  const name = mediaName(src);
  return (
    <span data-note-media={kind} className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-muted/60 px-2 py-1 text-muted-foreground">
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate">{name}</span>
    </span>
  );
}

function PreviewImage({ src, alt, width }: Readonly<{ src?: string; alt?: string; width: number | null }>) {
  if (videoEmbed(src ?? "")) return <PreviewMedia src={src ?? ""} kind="video" />;
  const media = noteMediaKind(src ?? "");
  if (media === "audio" || media === "video") return <PreviewMedia src={src ?? ""} kind={media} />;
  return <PreviewPicture src={src} alt={alt} style={width === null ? undefined : { width: `${width}%` }} />;
}

function PreviewPicture({ src = "", alt, style }: Readonly<{ src?: string; alt?: string; style?: CSSProperties }>) {
  const note = useContext(PreviewNoteContext);
  const source = imageSource(src);
  const path = source && "path" in source ? source.path : null;
  const [resolved, setResolved] = useState<{ path: string; url: string | null } | null>(null);
  const resolve = note?.resolve;
  const noteId = note?.noteId;
  useEffect(() => {
    if (!path || !resolve || noteId === undefined) return;
    let live = true;
    resolve(noteId, path).then(
      (url) => {
        if (live) setResolved({ path, url });
      },
      () => {
        if (live) setResolved({ path, url: null });
      },
    );
    return () => {
      live = false;
    };
  }, [noteId, path, resolve]);
  if (source && "url" in source) {
    const remote = remoteImage(source.url);
    if (remote) return <HeldImage remote={remote} alt={alt} still={note?.still === true} style={style} />;
    return <img src={source.url} alt={alt ?? ""} draggable={false} style={style} />;
  }
  if (path && resolve && resolved?.path !== path) return null;
  const url = resolved?.path === path ? resolved?.url : null;
  return url ? <img src={url} alt={alt ?? ""} draggable={false} style={style} /> : <MissingImage />;
}

function DrawnBlock({ kind, source }: Readonly<{ kind: string; source: string }>) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => paintStillBlock(kind, ref.current as HTMLDivElement, source), [kind, source]);
  return (
    <BlockFrame className="note-code note-drawn" data-block={kind} label={blockLabel(kind)}>
      <div ref={ref} className="note-drawn-preview" />
    </BlockFrame>
  );
}

function TaskBox({ checked }: Readonly<{ checked?: boolean }>) {
  return (
    <span
      data-checked={checked ? "true" : "false"}
      className={cn(
        "mr-2 inline-flex size-4 translate-y-0.5 items-center justify-center rounded border",
        checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50",
      )}
    >
      {checked && <Check aria-hidden className="size-3" strokeWidth={3} />}
    </span>
  );
}

const components: Components = {
  a: ({ children }) => <span className="text-primary underline">{children}</span>,
  img: ({ src, alt, node }) =>
    typeof src === "string" && parseNoteLink(src) ? (
      <span data-note-embed-link className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-primary">
        <SquareStack aria-hidden className="size-3.5" />
        {alt}
      </span>
    ) : (
      <PreviewImage src={typeof src === "string" ? src : undefined} alt={alt} width={imageWidthPercent(node?.properties[IMAGE_WIDTH])} />
    ),
  input: ({ checked }) => <TaskBox checked={checked} />,
  div: ({ node }) => (
    <DrawnBlock kind={String(node?.properties[DRAWN_BLOCK] ?? "")} source={String(node?.properties[DRAWN_SOURCE] ?? "")} />
  ),
};

function urlTransform(url: string, key: string): string {
  if (key === "src" && parseNoteLink(url)) return url;
  return key === "src" && imageSource(url) ? url : defaultUrlTransform(url);
}

export function fullPreviewTree() {
  return (tree: HastParent) => {
    noteInline(tree);
    prune(tree, { blocks: 0, full: true });
  };
}

const TRIMMED: MarkdownDocumentOptions = { namespace: "note-hover", rehypePlugins: [trimPreviewTree], components, urlTransform };
const FULL: MarkdownDocumentOptions = { namespace: "note-full", rehypePlugins: [fullPreviewTree], components, urlTransform };

export function NoteMarkdown({
  noteId,
  source,
  color,
  resolveAsset,
  full = false,
  className,
}: Readonly<{
  noteId: string;
  source: string;
  color?: string;
  resolveAsset?: (noteId: string, path: string) => Promise<string | null>;
  full?: boolean;
  className?: string;
}>) {
  const note = useMemo(() => ({ noteId, resolve: resolveAsset }), [noteId, resolveAsset]);
  const content = renderMarkdownDocument(stripBlockIdMarkers(source), false, true, full ? FULL : TRIMMED);
  return (
    <div className={cn("wysiwyg-content note-body", className)} style={noteColorStyle(color)}>
      <PreviewNoteContext.Provider value={note}>
        <div className="ProseMirror">{content}</div>
      </PreviewNoteContext.Provider>
    </div>
  );
}

export const NotePreview = memo(function NotePreview({
  noteId,
  source,
  color,
  resolveAsset,
  className,
}: Readonly<{
  noteId: string;
  source: string;
  color?: string;
  resolveAsset?: (noteId: string, path: string) => Promise<string | null>;
  className?: string;
}>) {
  const note = useMemo(() => ({ noteId, resolve: resolveAsset, still: true }), [noteId, resolveAsset]);
  const content = renderMarkdownDocument(stripBlockIdMarkers(source), false, true, TRIMMED);
  return (
    <div
      aria-hidden
      inert
      data-note-preview={noteId}
      className={cn("pointer-events-none relative select-none overflow-hidden [container-type:inline-size]", className)}
    >
      <div
        className="wysiwyg-content note-body absolute left-0 top-0 origin-top-left"
        style={{ ...noteColorStyle(color), width: `calc(100cqw / ${PREVIEW_SCALE})`, transform: `scale(${PREVIEW_SCALE})` }}
      >
        <PreviewNoteContext.Provider value={note}>
          <div className="ProseMirror">{content}</div>
        </PreviewNoteContext.Provider>
      </div>
    </div>
  );
});
