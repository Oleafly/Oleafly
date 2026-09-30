import { Children, isValidElement, memo, type ReactNode, useRef } from "react";
import rehypeKatex from "rehype-katex";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { personalParts } from "@/lib/display-path";
import { cn } from "@/lib/utils";
import { HighlightedCode } from "./code-highlighter";
import { MarkdownBlock } from "./markdown-block";
import { MermaidDiagram } from "./mermaid-diagram";
import { useHidePersonalDetails } from "./private";
import { RenderCache } from "./render-cache";
import {
  type StreamingMarkdownState,
  updateStreamingMarkdown,
} from "./streaming-markdown";

const codeBlockClassName =
  "overflow-x-auto rounded-md bg-background/70 p-2.5 text-[0.85em] [scrollbar-width:thin]";

const MAX_CACHED_DOCUMENTS = 200;
const MAX_CACHED_DOCUMENT_CHARS = 1_000_000;

function codeText(children: ReactNode) {
  return Children.toArray(children)
    .filter((child): child is string | number =>
      typeof child === "string" || typeof child === "number"
    )
    .join("");
}

function codeLanguage(className?: string) {
  return className?.match(/(?:^|\s)language-([^\s]+)/)?.[1]?.toLowerCase();
}

function hasPersonalRun(text: string): boolean {
  return personalParts(text).some((part) => part.personal);
}

function createMarkdownComponents(inverted: boolean, personal = false): Components {
  return {
  p: ({ children }) => <p className="mb-2 leading-relaxed last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed marker:text-muted-foreground">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="text-muted-foreground line-through">{children}</del>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "underline underline-offset-2",
        inverted ? "text-white" : "text-primary dark:text-primary",
      )}
    >
      {children}
    </a>
  ),
  h1: ({ children }) => <h1 className="mb-1 text-base font-semibold">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1 text-[0.95em] font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 text-[0.9em] font-semibold">{children}</h3>,
  hr: () => <hr className="my-2 border-border" />,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-border pl-2 italic text-muted-foreground">{children}</blockquote>
  ),
  pre: ({ children }) => {
    const childNodes = Children.toArray(children);
    const child = childNodes.length === 1 ? childNodes[0] : null;
    if (
      isValidElement<{ className?: string; children?: ReactNode }>(child) &&
      codeLanguage(child.props.className) === "mermaid"
    ) {
      const source = codeText(child.props.children).replace(/\n$/, "");
      return (
        <MarkdownBlock kind="diagram" source={source}>
          <MermaidDiagram key={source} source={source} />
        </MarkdownBlock>
      );
    }
    const source = isValidElement<{ children?: ReactNode }>(child)
      ? codeText(child.props.children).replace(/\n$/, "")
      : codeText(children).replace(/\n$/, "");
    // Screenshot mode blurs a whole code block that names a path: the block
    // keeps the real path so its copy button and the highlighting stay intact.
    const blurred = personal && hasPersonalRun(source);
    return (
      <MarkdownBlock kind="code" source={source}>
        <pre data-private={blurred ? "" : undefined} className={codeBlockClassName}>
          {children}
        </pre>
      </MarkdownBlock>
    );
  },
  code: ({ className, children }) => {
    const text = codeText(children);
    const language = codeLanguage(className);
    const isBlock = Boolean(language) || text.includes("\n");
    if (isBlock) {
      return <HighlightedCode className={className} language={language} source={text} />;
    }
    return (
      <code
        className={cn(
          "rounded-md px-1.5 py-0.5 font-mono text-[0.8em] font-medium",
          inverted ? "bg-white/15 text-white" : "bg-primary/10 text-primary",
        )}
      >
        {children}
      </code>
    );
  },
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto">
      <table className="w-full border-collapse text-[0.85em]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-border px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-border px-2 py-1 align-top">{children}</td>,
  };
}

export const markdownComponents = createMarkdownComponents(false);
const invertedMarkdownComponents = createMarkdownComponents(true);
const personalMarkdownComponents = createMarkdownComponents(false, true);
const invertedPersonalMarkdownComponents = createMarkdownComponents(true, true);

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

// Code blocks are handled whole in `pre` above, and KaTeX output is math.
const UNMARKED_TAGS = new Set(["pre", "math", "svg", "script", "style"]);

function isKatex(node: HastNode): boolean {
  const className = node.properties?.className;
  return Array.isArray(className) && className.some((name) => String(name).startsWith("katex"));
}

function markPersonalRuns(node: HastNode): void {
  if (!node.children) return;
  const children: HastNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && typeof child.value === "string") {
      const parts = personalParts(child.value);
      if (parts.some((part) => part.personal)) {
        for (const part of parts) {
          children.push(
            part.personal
              ? {
                  type: "element",
                  tagName: "span",
                  properties: { dataPrivate: "" },
                  children: [{ type: "text", value: part.text }],
                }
              : { type: "text", value: part.text },
          );
        }
        continue;
      }
    } else if (child.type === "element" && !UNMARKED_TAGS.has(child.tagName ?? "") && !isKatex(child)) {
      markPersonalRuns(child);
    }
    children.push(child);
  }
  node.children = children;
}

/** Screenshot mode: wraps each path and account name in the prose for the blur. */
function rehypePersonalRuns() {
  return (tree: HastNode) => markPersonalRuns(tree);
}

// Only `~~text~~` strikes through. A single `~` in chat is a home path (`~/a`,
// see src/lib/display-path.ts) or a LaTeX tie (`Fig.~\ref{a}`), and two of
// them in one paragraph would otherwise strike out the text between them.
const remarkPlugins: Options["remarkPlugins"] = [[remarkGfm, { singleTilde: false }], remarkMath];
const rehypePlugins: Options["rehypePlugins"] = [rehypeKatex];
const personalRehypePlugins: Options["rehypePlugins"] = [rehypeKatex, rehypePersonalRuns];

const newCache = () => new RenderCache<ReactNode>(MAX_CACHED_DOCUMENTS, MAX_CACHED_DOCUMENT_CHARS);

const documentCaches = {
  plain: newCache(),
  inverted: newCache(),
  personal: newCache(),
  invertedPersonal: newCache(),
};

function documentCache(inverted: boolean, personal: boolean) {
  if (personal) return inverted ? documentCaches.invertedPersonal : documentCaches.personal;
  return inverted ? documentCaches.inverted : documentCaches.plain;
}

function componentsFor(inverted: boolean, personal: boolean): Components {
  if (personal) return inverted ? invertedPersonalMarkdownComponents : personalMarkdownComponents;
  return inverted ? invertedMarkdownComponents : markdownComponents;
}

/** `personal` renders the screenshot-mode variant, which marks paths for the blur. */
export function renderMarkdownDocument(
  source: string,
  inverted: boolean,
  cache = true,
  personal = false,
): ReactNode {
  const documents = documentCache(inverted, personal);
  if (cache) {
    const cached = documents.get(source);
    if (cached !== undefined) return cached;
  }
  const rendered = ReactMarkdown({
    remarkPlugins,
    rehypePlugins: personal ? personalRehypePlugins : rehypePlugins,
    components: componentsFor(inverted, personal),
    children: source,
  });
  if (cache) documents.set(source, rendered, source.length + 1);
  return rendered;
}

export function isMarkdownDocumentCached(source: string, inverted = false): boolean {
  return documentCache(inverted, false).has(source);
}

export function clearMarkdownDocumentCache(): void {
  for (const documents of Object.values(documentCaches)) documents.clear();
}

function MarkdownDocument({
  children,
  inverted,
  cache = true,
  personal = false,
}: {
  children: string;
  inverted: boolean;
  cache?: boolean;
  personal?: boolean;
}) {
  return <>{renderMarkdownDocument(children, inverted, cache, personal)}</>;
}

const SettledMarkdownBlock = memo(function SettledMarkdownBlock({
  source,
  inverted,
  cache = true,
  personal = false,
}: Readonly<{
  source: string;
  inverted: boolean;
  cache?: boolean;
  personal?: boolean;
}>) {
  return (
    <MarkdownDocument inverted={inverted} cache={cache} personal={personal}>
      {source}
    </MarkdownDocument>
  );
});

export default function MarkdownRenderer({
  children,
  className,
  inverted = false,
  streaming = false,
}: Readonly<{
  children: string;
  className?: string;
  inverted?: boolean;
  streaming?: boolean;
}>) {
  const streamingState = useRef<StreamingMarkdownState | null>(null);
  const personal = useHidePersonalDetails();
  const livePartition = streaming
    ? updateStreamingMarkdown(streamingState.current, children)
    : null;
  const preservedPartition = !streaming
    && streamingState.current?.source === children
    && !streamingState.current.tail.raw
    ? streamingState.current
    : null;
  const partition = livePartition ?? preservedPartition;
  if (livePartition) streamingState.current = livePartition;
  else if (!preservedPartition) streamingState.current = null;
  const tailKey = partition
    ? `${children.length - partition.tail.source.length}`
    : "0";
  const partitionedContent = partition
    ? partition.settled.map((block) => (
        <SettledMarkdownBlock
          key={block.key}
          source={block.source}
          inverted={inverted}
          personal={personal}
        />
      ))
    : [];
  if (partition?.tail.source) {
    partitionedContent.push(
      partition.tail.raw ? (
        <div
          key={tailKey}
          data-streaming-raw="true"
          dir="auto"
          className="whitespace-pre-wrap break-words [unicode-bidi:plaintext]"
        >
          {partition.tail.source}
        </div>
      ) : (
        <SettledMarkdownBlock
          key={tailKey}
          source={partition.tail.source}
          inverted={inverted}
          cache={false}
          personal={personal}
        />
      ),
    );
  }
  return (
    <div
      data-streaming-markdown={streaming ? "true" : undefined}
      className={cn(
        "min-w-0 [&_.katex-display]:overflow-x-auto",
        className,
      )}
    >
      {partition ? (
        partitionedContent
      ) : (
        <MarkdownDocument inverted={inverted} personal={personal}>
          {children}
        </MarkdownDocument>
      )}
    </div>
  );
}
