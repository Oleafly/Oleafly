import { memo, type ReactNode, useEffect, useMemo, useState } from "react";
import { loadedMathRender, loadMathRender, type MathRenderModule } from "@oleafly/editor/math-render-loader";
import { cn } from "@/lib/utils";
import { useCommentErrorReport } from "./comment-kit";
import { type CommentInline, parseComment } from "./comment-markdown";
import { type CommentMember, mentionSegments } from "./mentions";

function useMathRender(): MathRenderModule | null {
  const report = useCommentErrorReport();
  const [render, setRender] = useState(loadedMathRender);
  useEffect(() => {
    if (render) return;
    let mounted = true;
    loadMathRender().then(
      (module) => {
        if (mounted) setRender(module);
      },
      (error: unknown) => report?.("comment math load", error),
    );
    return () => {
      mounted = false;
    };
  }, [render, report]);
  return render;
}

function CommentMath({ source, body, display }: Readonly<{ source: string; body: string; display: boolean }>) {
  const render = useMathRender();
  const result = useMemo(() => render?.renderMathSource(body, display) ?? null, [render, body, display]);
  if (result?.status !== "ready") return <span data-comment-math-source>{source}</span>;
  const shape = display ? "block max-w-full overflow-x-auto overflow-y-hidden" : undefined;
  // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMathSource returns KaTeX output made with trust off and then cut down to KaTeX's own tags and attributes, so no text from the message reaches the page as markup
  return <span data-comment-math={display ? "display" : "inline"} className={shape} dangerouslySetInnerHTML={{ __html: result.html }} />;
}

function Mentions({ text, members }: Readonly<{ text: string; members: readonly CommentMember[] }>) {
  let offset = 0;
  return mentionSegments(text, members).map((segment) => {
    const at = offset;
    offset += segment.text.length;
    return segment.mention ? (
      <span key={at} data-mention className="font-medium text-primary">
        {segment.text}
      </span>
    ) : (
      <span key={at}>{segment.text}</span>
    );
  });
}

function displayMath(node: CommentInline | undefined): boolean {
  return node?.kind === "math" && node.display;
}

function BesideDisplay({
  nodes,
  index,
  text,
  members,
}: Readonly<{ nodes: readonly CommentInline[]; index: number; text: string; members: readonly CommentMember[] }>) {
  const lead = displayMath(nodes[index - 1]) ? (/^\s*/u.exec(text)?.[0] ?? "") : "";
  const rest = text.slice(lead.length);
  const tail = displayMath(nodes[index + 1]) ? (/\s*$/u.exec(rest)?.[0] ?? "") : "";
  const middle = rest.slice(0, rest.length - tail.length);
  return (
    <>
      {lead ? <span className="[[data-comment-math=display]+&]:whitespace-normal">{lead}</span> : null}
      {middle ? <Mentions text={middle} members={members} /> : null}
      {tail ? <span className="[&:has(+[data-comment-math=display])]:whitespace-normal">{tail}</span> : null}
    </>
  );
}

function Inline({
  nodes,
  members,
}: Readonly<{ nodes: readonly CommentInline[]; members: readonly CommentMember[] }>): ReactNode {
  return nodes.map((node, index) => {
    const key = `${node.kind}-${index}`;
    if (node.kind === "text") {
      if (!displayMath(nodes[index - 1]) && !displayMath(nodes[index + 1])) {
        return <Mentions key={key} text={node.text} members={members} />;
      }
      return <BesideDisplay key={key} nodes={nodes} index={index} text={node.text} members={members} />;
    }
    if (node.kind === "code") {
      return (
        <code key={key} className="rounded-sm border border-border/70 bg-muted px-1 py-px font-mono text-[0.92em]">
          {node.text}
        </code>
      );
    }
    if (node.kind === "math") return <CommentMath key={key} source={node.source} body={node.body} display={node.display} />;
    if (node.kind === "link") {
      return (
        <a
          key={key}
          href={node.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary focus-visible:bg-primary/10"
        >
          {node.text}
        </a>
      );
    }
    const inner = <Inline key={`${key}-inner`} nodes={node.children} members={members} />;
    if (node.kind === "bold") {
      return (
        <strong key={key} className="font-semibold text-foreground">
          {inner}
        </strong>
      );
    }
    return node.kind === "italic" ? <em key={key}>{inner}</em> : <s key={key}>{inner}</s>;
  });
}

export const CommentBody = memo(function CommentBody({
  body,
  members,
  math = false,
  markdown = true,
  className,
}: Readonly<{ body: string; members: readonly CommentMember[]; math?: boolean; markdown?: boolean; className?: string }>) {
  const blocks = useMemo(() => parseComment(body, { math, markdown }), [body, math, markdown]);
  return (
    <div
      data-comment-body
      className={cn(
        "mt-0.5 select-text space-y-1 break-words text-[0.8125rem] leading-[1.55] text-foreground/90",
        className,
      )}
    >
      {blocks.map((block, index) => {
        const key = `${block.kind}-${index}`;
        if (block.kind === "paragraph") {
          return (
            <p key={key} className="whitespace-pre-wrap">
              <Inline nodes={block.children} members={members} />
            </p>
          );
        }
        const items = block.items.map((item, at) => {
          const id = `${key}-${at}`;
          return (
            <li key={id}>
              <Inline nodes={item} members={members} />
            </li>
          );
        });
        return block.kind === "bullet" ? (
          <ul key={key} className="list-disc space-y-0.5 pl-5">
            {items}
          </ul>
        ) : (
          <ol key={key} start={block.start} className="list-decimal space-y-0.5 pl-5">
            {items}
          </ol>
        );
      })}
    </div>
  );
});
