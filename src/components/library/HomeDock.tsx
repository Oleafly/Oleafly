import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PenTool, Plus, Search, Settings as SettingsIcon, ToolCase } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { ThemeMenu } from "@/components/layout/ThemeControls";
import { cn, isMac, shortcut } from "@/lib/utils";
import { useFullscreen } from "@/lib/use-fullscreen";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { shortcutLabel, useShortcutStore } from "@/store/shortcuts";
import { useSettingsStore } from "@/store/settings";
import { openDiagramComposerChooser, openToolsGallery } from "@/features/open-tool";
import { HOME_CHROME_SURFACE } from "@/components/library/home-chrome";

const DOCK_BUTTON_SHAPE = "rounded-full hover:scale-[1.2]";

const dockButtonClass = (active: boolean) =>
  cn(
    DOCK_BUTTON_SHAPE,
    active
      ? "bg-accent text-foreground hover:bg-accent"
      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
  );

function DockButton({
  label,
  tooltip = label,
  icon,
  onClick,
  primary = false,
  active = false,
  testId,
  tour,
  tooltipSide,
}: Readonly<{
  label: string;
  tooltip?: string;
  icon: ReactNode;
  onClick: () => void;
  primary?: boolean;
  active?: boolean;
  testId?: string;
  tour?: string;
  tooltipSide: "top" | "left" | "right";
}>) {
  return (
    <Tooltip label={tooltip} side={tooltipSide}>
      <Button
        data-testid={testId}
        data-tour={tour}
        data-active={active ? "true" : "false"}
        variant={primary ? "default" : "ghost"}
        size="icon"
        aria-label={label}
        className={primary ? DOCK_BUTTON_SHAPE : dockButtonClass(active)}
        onClick={onClick}
      >
        {icon}
      </Button>
    </Tooltip>
  );
}

export const HOME_DOCK_GLASS_SURFACE =
  "border border-black/10 bg-white/10 shadow-[0_4px_20px_-6px_rgba(0,0,0,0.1),inset_0_1px_0_0_rgba(255,255,255,0.3)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-white/5 dark:shadow-[0_8px_30px_-6px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.08)]";

export function HomeDock() {
  const { t } = useTranslation(["library", "shell"]);
  const setNewProjectOpen = useSettingsStore((s) => s.setNewProjectOpen);
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen);
  const settingsShortcut = useShortcutStore((s) => shortcutLabel(s.bindings.openSettings));
  const setSearchOpen = useSettingsStore((s) => s.setSearchOpen);
  const dockPlacement = useSettingsStore((s) => s.dockPlacement);
  const latexTools = useSettingsStore((s) => s.latexTools);
  const hasProjects = useFilesStore((s) => s.projects.length > 0);
  const fullscreen = useFullscreen();
  const page = useHomeViewStore((s) => s.page);
  const horizontal = dockPlacement === "bottom";
  const verticalTooltipSide = dockPlacement === "right" ? "left" : "right";
  const tooltipSide = horizontal ? "top" : verticalTooltipSide;

  const items = (
    <>
      <DockButton
        label={t(($) => $.library.dock.newProject)}
        icon={<Plus className="size-4" />}
        onClick={() => setNewProjectOpen(true)}
        primary
        testId="new-project"
        tour="new-project"
        tooltipSide={tooltipSide}
      />
      {hasProjects && (
        <DockButton
          label={t(($) => $.library.dock.search, { shortcut: shortcut("⌘⇧F") })}
          icon={<Search className="size-4" />}
          onClick={() => setSearchOpen(true)}
          testId="open-search"
          tooltipSide={tooltipSide}
        />
      )}
      <DockButton
        label={t(($) => $.library.dock.diagramComposer)}
        icon={<PenTool className="size-4" />}
        onClick={openDiagramComposerChooser}
        active={page === "diagram-composer"}
        testId="open-diagram-composer"
        tooltipSide={tooltipSide}
      />
      {latexTools && (
        <DockButton
          label={t(($) => $.library.dock.tools)}
          icon={<ToolCase className="size-4" />}
          onClick={() => void openToolsGallery()}
          active={page === "tools"}
          testId="open-latex-tools"
          tooltipSide={tooltipSide}
        />
      )}
      <ThemeMenu
        side={tooltipSide}
        align="center"
        triggerClassName={dockButtonClass(false)}
        testId="home-theme-menu"
      />
      <DockButton
        label={t(($) => $.library.dock.settings)}
        tooltip={t(($) => $.shell.rail.withShortcut, {
          label: t(($) => $.library.dock.settings),
          shortcut: settingsShortcut,
        })}
        icon={<SettingsIcon className="size-4" />}
        onClick={() => setSettingsOpen(true)}
        testId="open-settings"
        tour="settings"
        tooltipSide={tooltipSide}
      />
    </>
  );

  if (horizontal) {
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center pb-4">
        <div
          data-testid="home-dock"
          data-placement="bottom"
          className={cn(
            "pointer-events-auto flex items-center gap-2 rounded-2xl p-1.5",
            HOME_CHROME_SURFACE,
          )}
        >
          {items}
        </div>
      </div>
    );
  }

  const isRight = dockPlacement === "right";

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-y-0 z-30 flex items-center",
        isRight ? "right-0 pr-4" : "left-0 pl-4",
        isMac && !fullscreen && "pt-7",
      )}
    >
      <div
        data-testid="home-dock"
        data-placement={dockPlacement}
        className={cn(
          "pointer-events-auto flex flex-col items-center gap-2 rounded-2xl p-1.5",
          HOME_CHROME_SURFACE,
        )}
      >
        {items}
      </div>
    </div>
  );
}
