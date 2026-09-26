import { useTranslation } from "react-i18next";
import { FolderOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { HOME_DOCK_GLASS_SURFACE } from "@/components/library/HomeDock";
import { openFolderWithPicker } from "@/features/open-folder";
import { cn } from "@/lib/utils";
import { useOpenFolderFlowStore } from "@/store/open-folder-flow";
import { shortcutLabel, useShortcutStore } from "@/store/shortcuts";

export function OpenFolderButton({ className }: Readonly<{ className?: string }>) {
  const { t } = useTranslation(["library"]);
  const opening = useOpenFolderFlowStore((state) => state.opening);
  const binding = useShortcutStore((state) => state.bindings.openFolder);
  return (
    <Tooltip
      label={t(($) => $.library.home.openFolderShortcut, { shortcut: shortcutLabel(binding) })}
      className={className}
    >
      <Button
        data-testid="open-folder-button"
        variant="ghost"
        disabled={opening}
        className={cn(
          HOME_DOCK_GLASS_SURFACE,
          "h-10 gap-2 whitespace-nowrap rounded-2xl !bg-background/75 px-3.5 text-sm font-medium text-foreground shadow-sm hover:!bg-accent/80 focus-visible:!bg-accent dark:!bg-background/65 dark:shadow-sm dark:hover:!bg-accent/60",
        )}
        onClick={() => void openFolderWithPicker()}
      >
        {opening ? (
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        ) : (
          <FolderOpen aria-hidden="true" className="size-4 text-muted-foreground" />
        )}
        {t(($) => $.library.home.openFolder)}
      </Button>
    </Tooltip>
  );
}
