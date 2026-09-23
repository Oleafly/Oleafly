import { Children, isValidElement, memo, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

const OPENABLE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function openableReleaseLink(href: string | undefined): string | null {
  if (!href) return null;
  try {
    const url = new URL(href);
    return OPENABLE_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export const PRIMARY_TEXT = "text-primary dark:text-[color-mix(in_oklab,var(--primary)_72%,white)]";


function textOf(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child);
      if (isValidElement<{ children?: ReactNode }>(child)) return textOf(child.props.children);
      return "";
    })
    .join("");
}

function CodeBlock({ children }: Readonly<{ children: ReactNode }>) {
  const { t } = useTranslation(["common"]);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = () => {
    const text = textOf(children).replace(/\n$/, "");
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1500);
      },
      () => setCopied(false),
    );
  };
  const label = copied ? t(($) => $.common.actions.copied) : t(($) => $.common.actions.copy);
  return (
    <div className="group relative mb-2">
      <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-3 pr-10 text-xs leading-relaxed [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0">
        {children}
      </pre>
      <button
        type="button"
        onClick={copy}
        aria-label={label}
        title={label}
        className="absolute right-1.5 top-1.5 rounded-md border bg-popover p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
      >
        {copied ? <Check aria-hidden="true" className={cn("size-3.5", PRIMARY_TEXT)} /> : <Copy aria-hidden="true" className="size-3.5" />}
      </button>
    </div>
  );
}

function releaseNoteComponents(onOpenLink: (url: string) => void): Components {
  return {
    h1: ({ children }) => <h2 className="mb-2 text-xs font-semibold text-foreground">{children}</h2>,
    h2: ({ children }) => <h2 className="mb-2 text-xs font-semibold text-foreground">{children}</h2>,
    h3: ({ children }) => <h3 className="mb-1.5 mt-4 text-sm font-semibold text-foreground first:mt-0">{children}</h3>,
    h4: ({ children }) => <h4 className="mb-1 mt-3 text-xs font-semibold text-foreground">{children}</h4>,
    p: ({ children }) => <p className="mb-2 leading-relaxed last:mb-0">{children}</p>,
    ul: ({ children }) => (
      <ul className="mb-2 list-none space-y-1 last:mb-0 [&_ul]:mb-0 [&_ul]:mt-1 [&>li]:relative [&>li]:pl-3.5 [&>li]:before:absolute [&>li]:before:left-0.5 [&>li]:before:top-[0.6em] [&>li]:before:size-[5px] [&>li]:before:rounded-full [&>li]:before:bg-primary/70">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="mb-2 list-decimal space-y-1 pl-5 marker:text-muted-foreground last:mb-0">{children}</ol>
    ),
    li: ({ children }) => <li className="leading-relaxed [&>p]:mb-0.5">{children}</li>,
    strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    del: ({ children }) => <del className="text-muted-foreground line-through">{children}</del>,
    a: ({ href, children }) => {
      const url = openableReleaseLink(href);
      if (!url) return <span className="text-foreground">{children}</span>;
      return (
        <a
          href={url}
          onClick={(event) => {
            event.preventDefault();
            onOpenLink(url);
          }}
          className={cn("font-medium underline decoration-primary/30 underline-offset-2 transition-colors hover:decoration-primary", PRIMARY_TEXT)}
        >
          {children}
          <ExternalLink aria-hidden="true" className="ml-0.5 inline size-3 -translate-y-px opacity-70" />
        </a>
      );
    },
    code: ({ className, children }) => (
      <code
        className={cn(
          "rounded-[5px] border border-border/60 bg-muted/70 px-1 py-px font-mono text-[0.86em] text-foreground",
          className,
        )}
      >
        {children}
      </code>
    ),
    pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
    blockquote: ({ children }) => (
      <blockquote className="mb-2 rounded-r-md border-l-2 border-primary/40 bg-muted/40 px-3 py-1.5 text-muted-foreground [&>p]:mb-0">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-3 border-border" />,
    img: ({ src, alt }) => {
      const url = openableReleaseLink(typeof src === "string" ? src : undefined);
      if (!url || url.startsWith("mailto:")) return null;
      return (
        <button
          type="button"
          onClick={() => onOpenLink(url)}
          className="my-2 block max-w-full overflow-hidden rounded-lg border transition-colors hover:border-foreground/30 focus-visible:border-foreground/40"
        >
          <img
            src={url}
            alt={alt ?? ""}
            loading="lazy"
            decoding="async"
            className="block max-h-60 max-w-full object-contain"
          />
        </button>
      );
    },
    table: ({ children }) => (
      <div className="mb-2 overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-xs">{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border-b bg-muted/50 px-2.5 py-1.5 text-left font-semibold text-foreground">{children}</th>
    ),
    td: ({ children }) => <td className="border-b px-2.5 py-1.5 align-top last:border-b-0">{children}</td>,
  };
}

const remarkPlugins = [remarkGfm];

export const ReleaseNotes = memo(function ReleaseNotes({
  source,
  onOpenLink,
  className,
}: Readonly<{
  source: string;
  onOpenLink: (url: string) => void;
  className?: string;
}>) {
  return (
    <div
      data-testid="release-notes"
      className={cn("min-w-0 break-words text-[13px] text-muted-foreground", className)}
    >
      <ReactMarkdown remarkPlugins={remarkPlugins} components={releaseNoteComponents(onOpenLink)}>
        {source}
      </ReactMarkdown>
    </div>
  );
});
