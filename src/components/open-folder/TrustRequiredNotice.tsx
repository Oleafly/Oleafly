import { useTranslation } from "react-i18next";
import { Loader2, RotateCcw, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  folderIsRestricted,
  terminalNeedsReopen,
  useFolderAccessStore,
} from "@/store/folder-access";

export function TrustRequiredNotice({
  projectId,
  reason,
  className,
}: Readonly<{ projectId: string | null; reason: string; className?: string }>) {
  const { t } = useTranslation(["shell"]);
  const restricted = useFolderAccessStore((state) => folderIsRestricted(state, projectId));
  const trusting = useFolderAccessStore((state) => state.trusting);
  const grant = useFolderAccessStore((state) => state.grant);
  if (!restricted) return null;
  return (
    <div
      data-testid="trust-required-notice"
      className={cn(
        "flex items-start gap-2 rounded-md border border-primary/20 bg-primary/5 p-2.5 text-xs text-foreground",
        className,
      )}
    >
      <ShieldAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="leading-relaxed">{reason}</p>
        <Button
          size="xs"
          variant="outline"
          disabled={trusting !== null}
          onClick={() => void grant("folder")}
        >
          {trusting === "folder" ? (
            <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" />
          ) : null}
          {t(($) => $.shell.openedFolder.trust.trustFolder)}
        </Button>
      </div>
    </div>
  );
}

export function RestrictedTerminalBadge({
  projectId,
  terminalId,
  onReopen,
}: Readonly<{ projectId: string | null; terminalId: string | null; onReopen: () => void }>) {
  const { t } = useTranslation(["shell"]);
  const restricted = useFolderAccessStore((state) => folderIsRestricted(state, projectId));
  const needsReopen = useFolderAccessStore((state) =>
    terminalNeedsReopen(state, projectId, terminalId),
  );
  const trusting = useFolderAccessStore((state) => state.trusting);
  const grant = useFolderAccessStore((state) => state.grant);
  if (!restricted && !needsReopen) return null;
  const status = restricted
    ? t(($) => $.shell.openedFolder.trust.terminal)
    : t(($) => $.shell.openedFolder.trust.terminalReopen);
  return (
    <DropdownMenu>
      <Tooltip label={status} side="bottom" wide>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={status}
            data-testid="terminal-restricted"
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-transparent text-amber-600 transition-colors hover:bg-accent focus-visible:border-border focus-visible:bg-accent data-[state=open]:bg-accent dark:text-amber-400"
          >
            <ShieldAlert aria-hidden className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="whitespace-normal font-normal leading-relaxed">
          {status}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {restricted ? (
          <DropdownMenuItem disabled={trusting !== null} onSelect={() => void grant("folder")}>
            <ShieldCheck aria-hidden className="size-4" />
            {t(($) => $.shell.openedFolder.trust.trustFolder)}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={onReopen}>
            <RotateCcw aria-hidden className="size-4" />
            {t(($) => $.shell.openedFolder.trust.reopenTerminal)}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
