import "katex/dist/katex.min.css";
import { Check, ImageOff, SquareStack } from "lucide-react";
import { createContext, memo, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components, type Options } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { RenderCache } from "@/components/ui/render-cache";
import { cn } from "@/lib/utils";
import { RemoteImageNotice } from "@/components/ui/remote-image-notice";
import { blockKindOf, blockLabel, imageSource, paintStillBlock } from "./block-views";
import { parseNoteLink } from "./note-link-format";
import {
  allowRemoteImage,
  type RemoteImage,
  remoteImage,
  remoteImageAllowed,
  subscribeRemoteImages,
} from "./note-remote-images";

export const PREVIEW_SCALE = 0.28;
export const PREVIEW_BLOCKS = 64;
export const PREVIEW_BLOCK_TEXT = 600;
export const PREVIEW_TABLE = 6;

const CACHE_ENTRIES = 400;
const CACHE_WEIGHT = 2_000_000;

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
  const kind = language ? blockKindOf(language.slice("language-".length)) : undefined;
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

function prune(parent: HastParent, state: { blocks: number; full?: boolean }): void {
  const kept: HastNode[] = [];
  for (const child of parent.children) {
    if (!isElement(child)) {
      kept.push(child);
      continue;
    }
    if (!state.full && state.blocks >= PREVIEW_BLOCKS) break;
    const node = drawnBlock(child) ?? imageFigure(child) ?? child;
    const drawn = DRAWN_BLOCK in node.properties;
    if (drawn || BLOCK_TAGS.has(node.tagName)) state.blocks += 1;
    if (!state.full && node.tagName === "table") trimTable(node);
    if (!state.full && TEXT_BLOCKS.has(node.tagName)) node.children = cutText(node.children, { left: PREVIEW_BLOCK_TEXT });
    if (!drawn) prune(node, state);
    kept.push(node);
  }
  parent.children = kept;
}

export function trimPreviewTree() {
  return (tree: HastParent) => {
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

function HeldImage({ remote, alt, still }: Readonly<{ remote: RemoteImage; alt?: string; still: boolean }>) {
  const loaded = useSyncExternalStore(
    subscribeRemoteImages,
    () => remoteImageAllowed(remote.url),
    () => false,
  );
  if (loaded) return <img src={remote.url} alt={alt ?? ""} draggable={false} />;
  return <RemoteImageNotice host={remote.host} alt={alt} onLoad={still ? undefined : () => allowRemoteImage(remote.url)} />;
}

function PreviewImage({ src, alt }: Readonly<{ src?: string; alt?: string }>) {
  const note = useContext(PreviewNoteContext);
  const source = imageSource(src ?? "");
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
    if (remote) return <HeldImage remote={remote} alt={alt} still={note?.still === true} />;
    return <img src={source.url} alt={alt ?? ""} draggable={false} />;
  }
  if (path && resolve && resolved?.path !== path) return null;
  const url = resolved?.path === path ? resolved?.url : null;
  return url ? <img src={url} alt={alt ?? ""} draggable={false} /> : <MissingImage />;
}

function DrawnBlock({ kind, source }: Readonly<{ kind: string; source: string }>) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => paintStillBlock(kind, ref.current as HTMLDivElement, source), [kind, source]);
  return (
    <div className="note-code note-drawn" data-block={kind}>
      <span className="note-drawn-label">{blockLabel(kind)}</span>
      <div ref={ref} className="note-drawn-preview" />
    </div>
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
  img: ({ src, alt }) =>
    typeof src === "string" && parseNoteLink(src) ? (
      <span data-note-embed-link className="note-embed-link">
        <SquareStack aria-hidden className="size-3.5" />
        {alt}
      </span>
    ) : (
      <PreviewImage src={typeof src === "string" ? src : undefined} alt={alt} />
    ),
  input: ({ checked }) => <TaskBox checked={checked} />,
  div: ({ node }) => (
    <DrawnBlock kind={String(node?.properties[DRAWN_BLOCK] ?? "")} source={String(node?.properties[DRAWN_SOURCE] ?? "")} />
  ),
};

const remarkPlugins: Options["remarkPlugins"] = [[remarkGfm, { singleTilde: false }], remarkMath];
const rehypePlugins = [trimPreviewTree, rehypeKatex] as Options["rehypePlugins"];

function urlTransform(url: string, key: string): string {
  if (key === "src" && parseNoteLink(url)) return url;
  return key === "src" && imageSource(url) ? url : defaultUrlTransform(url);
}

const rendered = new RenderCache<{ source: string; node: ReactNode }>(CACHE_ENTRIES, CACHE_WEIGHT);

export function previewContent(key: string, source: string): ReactNode {
  const cached = rendered.get(key);
  if (cached?.source === source) return cached.node;
  const node = ReactMarkdown({ remarkPlugins, rehypePlugins, components, urlTransform, children: source });
  rendered.set(key, { source, node }, source.length + 1);
  return node;
}

export function fullPreviewTree() {
  return (tree: HastParent) => {
    prune(tree, { blocks: 0, full: true });
  };
}

const fullRehypePlugins = [fullPreviewTree, rehypeKatex] as Options["rehypePlugins"];
const renderedFull = new RenderCache<{ source: string; node: ReactNode }>(CACHE_ENTRIES / 4, CACHE_WEIGHT);

export function fullContent(key: string, source: string): ReactNode {
  const cached = renderedFull.get(key);
  if (cached?.source === source) return cached.node;
  const node = ReactMarkdown({ remarkPlugins, rehypePlugins: fullRehypePlugins, components, urlTransform, children: source });
  renderedFull.set(key, { source, node }, source.length + 1);
  return node;
}

export function NoteMarkdown({
  noteId,
  source,
  resolveAsset,
  full = false,
  className,
}: Readonly<{
  noteId: string;
  source: string;
  resolveAsset?: (noteId: string, path: string) => Promise<string | null>;
  full?: boolean;
  className?: string;
}>) {
  const note = useMemo(() => ({ noteId, resolve: resolveAsset }), [noteId, resolveAsset]);
  const content = full ? fullContent(`${noteId}\0full\0${source.length}`, source) : previewContent(`${noteId}\0hover`, source);
  return (
    <div className={cn("wysiwyg-content note-body", className)}>
      <PreviewNoteContext.Provider value={note}>
        <div className="ProseMirror">{content}</div>
      </PreviewNoteContext.Provider>
    </div>
  );
}

export function clearPreviewCache(): void {
  rendered.clear();
}

export const NotePreview = memo(function NotePreview({
  noteId,
  updatedAt,
  source,
  resolveAsset,
  className,
}: Readonly<{
  noteId: string;
  updatedAt: number;
  source: string;
  resolveAsset?: (noteId: string, path: string) => Promise<string | null>;
  className?: string;
}>) {
  const note = useMemo(() => ({ noteId, resolve: resolveAsset, still: true }), [noteId, resolveAsset]);
  const content = previewContent(`${noteId}\0${updatedAt}`, source);
  return (
    <div
      aria-hidden
      inert
      data-note-preview={noteId}
      className={cn("pointer-events-none relative select-none overflow-hidden [container-type:inline-size]", className)}
    >
      <div
        className="wysiwyg-content note-body absolute left-0 top-0 origin-top-left"
        style={{ width: `calc(100cqw / ${PREVIEW_SCALE})`, transform: `scale(${PREVIEW_SCALE})` }}
      >
        <PreviewNoteContext.Provider value={note}>
          <div className="ProseMirror">{content}</div>
        </PreviewNoteContext.Provider>
      </div>
    </div>
  );
});
