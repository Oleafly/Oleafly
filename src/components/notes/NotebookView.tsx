import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BLOCK_MESSAGE } from "@/components/ui/block-frame";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { HighlightedCode } from "@/components/ui/code-highlighter";
import { Markdown } from "@/components/ui/markdown";
import { cn } from "@/lib/utils";
import type { CellRange } from "./notebook-block";
import { type NotebookCell, type NotebookOutput, parseNotebook, pickCells } from "./notebook-file";
import { nodeRoot } from "./node-root";

export const CELL_LIMIT = 20;
export const OUTPUT_LINES = 30;
const OUTPUT_CHARS = 6000;
const FRAME_POLICY =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'";
const FRAME_STYLE =
  "body{margin:0;padding:8px;font:12px/1.45 system-ui,sans-serif;color:#18181b;background:#fff}table{border-collapse:collapse}th,td{border:1px solid #e4e4e7;padding:2px 6px}th{background:#f4f4f5}";

export interface NotebookViewProps {
  text: string;
  cells?: CellRange | null;
  hideCode?: boolean;
}

const DROPPED = "script, link, meta, base, iframe, frame, object, embed";

export function inertHtml(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  for (const element of document.querySelectorAll(DROPPED)) element.remove();
  for (const element of document.querySelectorAll("*")) {
    for (const name of element.getAttributeNames()) {
      if (name.toLowerCase().startsWith("on")) element.removeAttribute(name);
    }
  }
  return `${document.head.innerHTML}${document.body.innerHTML}`;
}

function HtmlOutput({ html, number }: Readonly<{ html: string; number: number }>) {
  const { t } = useTranslation(["notes"]);
  const document = useMemo(() => htmlOutputDocument(inertHtml(html)), [html]);
  return (
    <iframe
      sandbox=""
      srcDoc={document}
      title={t(($) => $.notes.notebook.outputFrame, { number })}
      referrerPolicy="no-referrer"
      className="block h-60 w-full rounded-md border bg-white"
    />
  );
}

export function htmlOutputDocument(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${FRAME_POLICY}"><style>${FRAME_STYLE}</style></head><body>${html}</body></html>`;
}

function Message({ children }: Readonly<{ children: ReactNode }>) {
  return <p className={BLOCK_MESSAGE}>{children}</p>;
}

function LongText({ text, failed = false }: Readonly<{ text: string; failed?: boolean }>) {
  const { t } = useTranslation(["notes"]);
  const [open, setOpen] = useState(false);
  const lines = text.split("\n");
  const long = lines.length > OUTPUT_LINES || text.length > OUTPUT_CHARS;
  const shown = open || !long ? text : lines.slice(0, OUTPUT_LINES).join("\n").slice(0, OUTPUT_CHARS);
  return (
    <div data-notebook-text className="space-y-1">
      <CodeBlock
        code={text}
        preClassName={cn("whitespace-pre-wrap break-words", failed && "border-destructive/30 bg-destructive/5")}
      >
        {shown}
      </CodeBlock>
      {long && (
        <Button variant="ghost" size="xs" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? t(($) => $.notes.notebook.showLess) : t(($) => $.notes.notebook.showAll)}
        </Button>
      )}
    </div>
  );
}

function Output({ output, number }: Readonly<{ output: NotebookOutput; number: number }>) {
  const { t } = useTranslation(["notes"]);
  switch (output.type) {
    case "stream":
      return <LongText text={output.text} failed={output.name === "stderr"} />;
    case "image":
      return (
        <img
          src={output.src}
          alt={t(($) => $.notes.notebook.outputImage, { number })}
          draggable={false}
          className="max-w-full rounded-md bg-white"
        />
      );
    case "markdown":
      return <Markdown className="text-sm">{output.text}</Markdown>;
    case "html":
      return <HtmlOutput html={output.html} number={number} />;
    case "text":
      return <LongText text={output.text} />;
    case "error":
      return (
        <div data-notebook-error className="space-y-1">
          <p className="break-words font-mono text-xs font-medium text-destructive">
            {output.value ? `${output.name}: ${output.value}` : output.name}
          </p>
          {output.traceback && <LongText text={output.traceback} failed />}
        </div>
      );
  }
}

function Cell({
  cell,
  number,
  language,
  hideCode,
}: Readonly<{ cell: NotebookCell; number: number; language: string; hideCode: boolean }>) {
  if (cell.type === "markdown") {
    return (
      <div data-notebook-cell="markdown" className="pl-12">
        <Markdown className="text-sm">{cell.source}</Markdown>
      </div>
    );
  }
  if (cell.type === "raw") {
    return (
      <div data-notebook-cell="raw" className="pl-12">
        <CodeBlock code={cell.source} />
      </div>
    );
  }
  return (
    <div data-notebook-cell="code" className="flex gap-2">
      <span className="w-10 shrink-0 pt-2.5 text-right font-mono text-[0.6875rem] tabular-nums text-muted-foreground">
        {`[${cell.count ?? " "}]`}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        {!hideCode && (
          <CodeBlock code={cell.source}>
            <HighlightedCode language={language || undefined} source={cell.source} />
          </CodeBlock>
        )}
        {cell.outputs.map((output, index) => (
          <Output key={`${output.type}-${String(index)}`} output={output} number={number} />
        ))}
      </div>
    </div>
  );
}

export function NotebookView({ text, cells = null, hideCode = false }: Readonly<NotebookViewProps>) {
  const { t } = useTranslation(["notes"]);
  const parsed = useMemo(() => parseNotebook(text), [text]);
  const [all, setAll] = useState(false);
  if (!parsed.ok) {
    return (
      <Message>
        {parsed.problem === "json" ? t(($) => $.notes.notebook.invalid) : t(($) => $.notes.notebook.unsupported)}
      </Message>
    );
  }
  const { notebook } = parsed;
  if (notebook.cells.length === 0) return <Message>{t(($) => $.notes.notebook.empty)}</Message>;
  const picked = pickCells(notebook.cells, cells);
  if (picked.length === 0) {
    return <Message>{t(($) => $.notes.notebook.outOfRange, { count: notebook.cells.length })}</Message>;
  }
  const visible = hideCode
    ? picked.filter(({ cell }) => cell.type !== "code" || cell.outputs.length > 0)
    : picked;
  if (visible.length === 0) return <Message>{t(($) => $.notes.notebook.nothingShown)}</Message>;
  const shown = all ? visible : visible.slice(0, CELL_LIMIT);
  return (
    <div data-notebook className="w-full min-w-0 space-y-3 text-left">
      {shown.map(({ cell, number }) => (
        <Cell key={number} cell={cell} number={number} language={notebook.language} hideCode={hideCode} />
      ))}
      {visible.length > shown.length && (
        <Button variant="outline" size="xs" onClick={() => setAll(true)}>
          {t(($) => $.notes.notebook.showAllCells, { count: visible.length })}
        </Button>
      )}
    </div>
  );
}

export interface NotebookMount {
  render(props: NotebookViewProps): void;
  unmount(): void;
}

export function mountNotebook(host: HTMLElement): NotebookMount {
  const root = nodeRoot(host);
  return { render: (props) => root.render(<NotebookView {...props} />), unmount: root.unmount };
}
