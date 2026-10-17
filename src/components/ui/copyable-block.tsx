import type { ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCopyStatus } from "@/components/ui/use-copy-status";
import { cn } from "@/lib/utils";

export function CopyableBlock({
  children,
  source,
  className,
  copyLabel,
  copiedLabel,
  onCopyError,
}: Readonly<{
  children: ReactNode;
  source: string;
  className?: string;
  copyLabel?: string;
  copiedLabel?: string;
  onCopyError?: (error: unknown) => void;
}>) {
  const { t } = useTranslation(["common"]);
  const { copied, copy } = useCopyStatus({ onError: onCopyError });
  const label = copied
    ? (copiedLabel ?? t(($) => $.common.actions.copied))
    : (copyLabel ?? t(($) => $.common.actions.copy));

  return (
    <div className={cn("group/code-block relative min-w-0", className)}>
      {children}
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={() => void copy(source)}
        className="absolute right-1.5 top-1.5 z-10 rounded-md border border-border/60 bg-background/90 p-1.5 text-muted-foreground opacity-0 shadow-sm backdrop-blur-sm transition-colors transition-opacity after:absolute after:-inset-2 after:content-[''] hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-focus-within/code-block:opacity-100 group-hover/code-block:opacity-100 motion-reduce:transition-none [@media(pointer:coarse)]:opacity-100 focus-visible:border-ring"
      >
        {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}
