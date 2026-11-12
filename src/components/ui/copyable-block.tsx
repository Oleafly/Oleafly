import type { ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BLOCK_REVEAL, BlockFrame } from "@/components/ui/block-frame";
import { useCopyStatus } from "@/components/ui/use-copy-status";

export { COPIED_FEEDBACK_MS } from "@/components/ui/use-copy-status";

export const COPY_BUTTON_CLASS = `relative rounded-md border border-border/60 bg-background/90 p-1.5 text-muted-foreground shadow-sm backdrop-blur-sm after:absolute after:-inset-2 after:content-[''] hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground ${BLOCK_REVEAL}`;

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
    <BlockFrame
      framed={false}
      className={className}
      actions={
        <button type="button" aria-label={label} title={label} onClick={() => void copy(source)} className={COPY_BUTTON_CLASS}>
          {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
        </button>
      }
    >
      {children}
    </BlockFrame>
  );
}
