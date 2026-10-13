import type { HTMLAttributes, ReactNode } from "react";
import { CopyableBlock } from "@/components/ui/copyable-block";
import { cn } from "@/lib/utils";

export function CodeBlock({
  code,
  children,
  className,
  preClassName,
  onCopyError,
  ...pre
}: Readonly<
  {
    code: string;
    children?: ReactNode;
    className?: string;
    preClassName?: string;
    onCopyError?: (error: unknown) => void;
  } & Omit<HTMLAttributes<HTMLPreElement>, "children" | "className">
>) {
  return (
    <CopyableBlock source={code} className={className} onCopyError={onCopyError}>
      <pre
        data-select-all-scope
        {...pre}
        className={cn(
          "select-text overflow-auto rounded-md border bg-muted/40 p-3 pr-10 font-mono text-[0.6875rem] leading-relaxed",
          preClassName,
        )}
      >
        {children ?? code}
      </pre>
    </CopyableBlock>
  );
}
