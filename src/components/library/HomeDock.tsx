import type { ReactNode } from "react";
import { Clock3, Moon, Plus, Settings as SettingsIcon, Sun, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn, isMac } from "@/lib/utils";
import { useFullscreen } from "@/lib/use-fullscreen";
import { useTheme } from "@/lib/theme";
import { useDeadlinesStore } from "@/store/deadlines";
import { useHomeViewStore } from "@/store/home-view";
import { useSettingsStore } from "@/store/settings";

function DockButton({
  label,
  icon,
  onClick,
  primary = false,
  active = false,
  testId,
  tour,
  horizontal,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  primary?: boolean;
  active?: boolean;
  testId?: string;
  tour?: string;
  horizontal: boolean;
}) {
  return (
    <Tooltip label={label} side={horizontal ? "top" : "right"}>
      <Button
        data-testid={testId}
        data-tour={tour}
        data-active={active ? "true" : "false"}
        variant={primary ? "default" : "ghost"}
        size="icon"
        aria-label={label}
        className={cn(
          "rounded-xl hover:scale-[1.2]",
          !primary &&
            (active
              ? "bg-white/20 text-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)] hover:bg-white/25 dark:bg-white/10 dark:hover:bg-white/15"
              : "text-muted-foreground hover:bg-white/10 hover:text-foreground dark:hover:bg-white/10"),
        )}
        onClick={onClick}
      >
        {icon}
      </Button>
    </Tooltip>
  );
}

const GLASS_SURFACE =
  "border border-white/30 bg-white/10 shadow-[0_8px_30px_-6px_rgba(0,0,0,0.3),inset_0_1px_0_0_rgba(255,255,255,0.3)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-white/5 dark:shadow-[0_8px_30px_-6px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.08)]";

export function HomeDock() {
  const setNewProjectOpen = useSettingsStore((s) => s.setNewProjectOpen);
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen);
  const dockPlacement = useSettingsStore((s) => s.dockPlacement);
  const { theme, toggleTheme } = useTheme();
  const fullscreen = useFullscreen();
  const deadlinesOpen = useHomeViewStore((s) => s.deadlinesOpen);
  const toolsOpen = useHomeViewStore((s) => s.toolsOpen);
  const openDeadlines = useHomeViewStore((s) => s.openDeadlines);
  const openTools = useHomeViewStore((s) => s.openTools);
  const horizontal = dockPlacement === "bottom";

  const items = (
    <>
      <DockButton
        label="New project"
        icon={<Plus className="size-4" />}
        onClick={() => setNewProjectOpen(true)}
        primary
        testId="new-project"
        tour="new-project"
        horizontal={horizontal}
      />
      <DockButton
        label="CCF Deadlines"
        icon={<Clock3 className="size-4" />}
        onClick={() => {
          void useDeadlinesStore.getState().openView();
          openDeadlines();
        }}
        active={deadlinesOpen}
        testId="open-deadlines"
        horizontal={horizontal}
      />
      <DockButton
        label="LaTeX Tools"
        icon={<Wrench className="size-4" />}
        onClick={openTools}
        active={toolsOpen}
        testId="open-latex-tools"
        horizontal={horizontal}
      />
      <DockButton
        label={theme === "dark" ? "Light theme" : "Dark theme"}
        icon={theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        onClick={toggleTheme}
        testId="toggle-theme"
        horizontal={horizontal}
      />
      <DockButton
        label="Settings"
        icon={<SettingsIcon className="size-4" />}
        onClick={() => setSettingsOpen(true)}
        testId="open-settings"
        tour="settings"
        horizontal={horizontal}
      />
    </>
  );

  if (horizontal) {
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center pb-4">
        <div
          data-testid="home-dock"
          data-placement="bottom"
          className={cn("pointer-events-auto flex items-center gap-1 rounded-2xl p-1.5", GLASS_SURFACE)}
        >
          {items}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-y-0 left-0 z-30 flex items-center pl-4",
        isMac && !fullscreen && "pt-7",
      )}
    >
      <div
        data-testid="home-dock"
        data-placement="left"
        className={cn("pointer-events-auto flex flex-col items-center gap-1 rounded-2xl p-1.5", GLASS_SURFACE)}
      >
        {items}
      </div>
    </div>
  );
}
