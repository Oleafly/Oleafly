import { memo, type ReactNode, useMemo } from "react";
import { cn } from "@/lib/utils";
import { type CommentInline, parseComment } from "./comment-markdown";
import { type CommentMember, mentionSegments } from "./mentions";

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

function Inline({
  nodes,
  members,
}: Readonly<{ nodes: readonly CommentInline[]; members: readonly CommentMember[] }>): ReactNode {
  return nodes.map((node, index) => {
    const key = `${node.kind}-${index}`;
    if (node.kind === "text") return <Mentions key={key} text={node.text} members={members} />;
    if (node.kind === "code") {
      return (
        <code key={key} className="rounded-sm border border-border/70 bg-muted px-1 py-px font-mono text-[0.92em]">
          {node.text}
        </code>
      );
    }
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
  className,
}: Readonly<{ body: string; members: readonly CommentMember[]; className?: string }>) {
  const blocks = useMemo(() => parseComment(body), [body]);
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
