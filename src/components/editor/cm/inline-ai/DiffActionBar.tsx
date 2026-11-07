import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, MessageSquareShare, RotateCcw, X } from "lucide-react";
import { AiChrome } from "@/components/ai/AiChrome";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

function DiffAction({
  icon: Icon,
  label,
  keyShortcut,
  onClick,
}: Readonly<{
  icon: ComponentType<{ className?: string }>;
  label: string;
  keyShortcut?: string;
  onClick: () => void;
}>) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-keyshortcuts={keyShortcut}
        className={cn(
          "inline-flex size-7 items-center justify-center text-primary transition-colors",
          "hover:bg-primary/15 focus-visible:bg-primary/15",
        )}
      >
        <Icon className="size-4" />
      </button>
    </Tooltip>
  );
}

export function DiffActionBar({
  onAccept,
  onReject,
  onRetry,
  onOpenInAgent,
}: Readonly<{
  onAccept: () => void;
  onReject: () => void;
  onRetry: () => void;
  onOpenInAgent?: () => void;
}>) {
  const { t } = useTranslation(["common", "editor"]);
  return (
    <AiChrome
      borderVariant="animated"
      className="w-fit"
      contentClassName="ai-surface-elevated flex items-center gap-1 p-1 text-popover-foreground"
    >
      <div className="flex items-center divide-x divide-primary/20 overflow-hidden rounded-md bg-primary/10">
        <DiffAction
          icon={Check}
          label={t(($) => $.editor.inlineAi.accept)}
          keyShortcut="Enter"
          onClick={onAccept}
        />
        <DiffAction
          icon={X}
          label={t(($) => $.editor.inlineAi.reject)}
          keyShortcut="Escape"
          onClick={onReject}
        />
        <DiffAction icon={RotateCcw} label={t(($) => $.editor.inlineAi.retry)} onClick={onRetry} />
      </div>
      {onOpenInAgent && (
        <Tooltip label={t(($) => $.editor.inlineAi.openInAgent)}>
          <button
            type="button"
            onClick={onOpenInAgent}
            aria-label={t(($) => $.editor.inlineAi.openInAgent)}
            className="inline-flex size-7 items-center justify-center rounded-md text-primary transition-colors hover:bg-primary/15 focus-visible:bg-primary/15"
          >
            <MessageSquareShare className="size-4" />
          </button>
        </Tooltip>
      )}
    </AiChrome>
  );
}

export function DiffErrorBar({
  message,
  onRetry,
  onDismiss,
}: Readonly<{
  message: string;
  onRetry: () => void;
  onDismiss: () => void;
}>) {
  const { t } = useTranslation(["common", "editor"]);
  return (
    <AiChrome
      borderVariant="primary"
      className="w-full"
      contentClassName="ai-surface-elevated p-2 text-popover-foreground"
    >
      <p className="flex items-start gap-1.5 text-xs text-destructive">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 break-words">
          {t(($) => $.editor.inlineAi.generateFailed, { message })}
        </span>
      </p>
      <div className="mt-2 flex items-center gap-1">
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          <RotateCcw className="size-3.5" /> {t(($) => $.editor.inlineAi.retry)}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {t(($) => $.editor.inlineAi.dismiss)}
        </button>
      </div>
    </AiChrome>
  );
}

export function DiffWithdrawnBar({ onDismiss }: Readonly<{ onDismiss: () => void }>) {
  const { t } = useTranslation(["common", "editor"]);
  return (
    <AiChrome
      borderVariant="primary"
      className="w-full"
      contentClassName="ai-surface-elevated flex items-center gap-2 p-2 text-popover-foreground"
    >
      <p className="min-w-0 flex-1 text-xs text-muted-foreground">
        {t(($) => $.editor.inlineAi.withdrawn)}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
      >
        {t(($) => $.editor.inlineAi.dismiss)}
      </button>
    </AiChrome>
  );
}
