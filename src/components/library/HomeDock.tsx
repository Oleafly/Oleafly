import type { ReactNode } from "react";
import { PenTool, Plus, Search, Settings as SettingsIcon, ToolCase } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { ThemeMenu } from "@/components/layout/ThemeControls";
import { cn, isMac, shortcut } from "@/lib/utils";
import { useFullscreen } from "@/lib/use-fullscreen";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useSettingsStore } from "@/store/settings";

const DOCK_BUTTON_SHAPE = "rounded-full hover:scale-[1.2]";

const dockButtonClass = (active: boolean) =>
  cn(
    DOCK_BUTTON_SHAPE,
    active
      ? "bg-white/20 text-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)] hover:bg-white/25 dark:bg-white/10 dark:hover:bg-white/15"
      : "text-muted-foreground hover:bg-white/10 hover:text-foreground dark:hover:bg-white/10",
  );

function DockButton({
  label,
  icon,
  onClick,
  primary = false,
  active = false,
  testId,
  tour,
  tooltipSide,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  primary?: boolean;
  active?: boolean;
  testId?: string;
  tour?: string;
  tooltipSide: "top" | "left" | "right";
}) {
  return (
    <Tooltip label={label} side={tooltipSide}>
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
  "border border-white/30 bg-white/10 shadow-[0_8px_30px_-6px_rgba(0,0,0,0.3),inset_0_1px_0_0_rgba(255,255,255,0.3)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-white/5 dark:shadow-[0_8px_30px_-6px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.08)]";

export function HomeDock() {
  const setNewProjectOpen = useSettingsStore((s) => s.setNewProjectOpen);
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen);
  const setSearchOpen = useSettingsStore((s) => s.setSearchOpen);
  const dockPlacement = useSettingsStore((s) => s.dockPlacement);
  const latexTools = useSettingsStore((s) => s.latexTools);
  const hasProjects = useFilesStore((s) => s.projects.length > 0);
  const fullscreen = useFullscreen();
  const toolsOpen = useHomeViewStore((s) => s.toolsOpen);
  const openTools = useHomeViewStore((s) => s.openTools);
  const page = useHomeViewStore((s) => s.page);
  const goTo = useHomeViewStore((s) => s.goTo);
  const horizontal = dockPlacement === "bottom";
  const tooltipSide = horizontal ? "top" : dockPlacement === "right" ? "left" : "right";

  const items = (
    <>
      <DockButton
        label="New project"
        icon={<Plus className="size-4" />}
        onClick={() => setNewProjectOpen(true)}
        primary
        testId="new-project"
        tour="new-project"
        tooltipSide={tooltipSide}
      />
      {hasProjects && (
        <DockButton
          label={`Search Documents (${shortcut("⌘⇧F")})`}
          icon={<Search className="size-4" />}
          onClick={() => setSearchOpen(true)}
          testId="open-search"
          tooltipSide={tooltipSide}
        />
      )}
      <DockButton
        label="Diagram Composer"
        icon={<PenTool className="size-4" />}
        onClick={() => goTo("diagram-composer")}
        active={page === "diagram-composer"}
        testId="open-diagram-composer"
        tooltipSide={tooltipSide}
      />
      {latexTools && (
        <DockButton
          label="Oleafly Tools"
          icon={<ToolCase className="size-4" />}
          onClick={openTools}
          active={toolsOpen}
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
        label="Settings"
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
            HOME_DOCK_GLASS_SURFACE,
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
          HOME_DOCK_GLASS_SURFACE,
        )}
      >
        {items}
      </div>
    </div>
  );
}
