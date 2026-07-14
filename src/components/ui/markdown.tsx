import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

// Kept dependency-light: `react-markdown` + `remark-gfm` only.
export const markdownComponents: Components = {
  p: ({ children }) => <p className="mb-2 leading-relaxed last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed marker:text-muted-foreground">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="text-muted-foreground line-through">{children}</del>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2 dark:text-primary">
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
  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto rounded-md bg-background/70 p-2.5 text-[0.85em] [scrollbar-width:thin]">
      {children}
    </pre>
  ),
  code: ({ className, children }) => {
    const text = typeof children === "string" ? children : "";
    const isBlock = /language-/.test(className || "") || text.includes("\n");
    if (isBlock) return <code className={cn("font-mono", className)}>{children}</code>;
    return (
      <code className="rounded-md border border-primary/20 bg-primary/10 px-1.5 py-0.5 font-mono text-[0.8em] font-medium text-primary">
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

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
