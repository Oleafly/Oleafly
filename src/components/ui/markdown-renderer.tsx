import { Children, isValidElement, type ReactNode } from "react";
import rehypeKatex from "rehype-katex";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { cn } from "@/lib/utils";
import { HighlightedCode } from "./code-highlighter";
import { MermaidDiagram } from "./mermaid-diagram";

const codeBlockClassName =
  "mb-2 overflow-x-auto rounded-md bg-background/70 p-2.5 text-[0.85em] [scrollbar-width:thin]";

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

function createMarkdownComponents(inverted: boolean): Components {
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
      return <MermaidDiagram source={codeText(child.props.children).replace(/\n$/, "")} />;
    }
    return <pre className={codeBlockClassName}>{children}</pre>;
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
          "rounded-md border px-1.5 py-0.5 font-mono text-[0.8em] font-medium",
          inverted
            ? "border-white/20 bg-white/10 text-white"
            : "border-primary/20 bg-primary/10 text-primary",
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

export default function MarkdownRenderer({
  children,
  className,
  inverted = false,
}: {
  children: string;
  className?: string;
  inverted?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-0 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={inverted ? invertedMarkdownComponents : markdownComponents}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
