import { useTranslation } from "react-i18next";
import { FolderOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { HOME_CHROME_SURFACE } from "@/components/library/home-chrome";
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
        size="icon"
        disabled={opening}
        aria-label={t(($) => $.library.home.openFolder)}
        className={cn(
          HOME_CHROME_SURFACE,
          "size-10 rounded-2xl p-0 text-muted-foreground hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground dark:focus-visible:bg-accent/60",
        )}
        onClick={() => void openFolderWithPicker()}
      >
        {opening ? (
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        ) : (
          <FolderOpen aria-hidden="true" className="size-4" />
        )}
      </Button>
    </Tooltip>
  );
}
