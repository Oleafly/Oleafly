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
        variant={primary ? "default" : active ? "secondary" : "ghost"}
        size="icon"
        aria-label={label}
        className={cn("rounded-xl", !primary && !active && "text-muted-foreground hover:text-foreground")}
        onClick={onClick}
      >
        {icon}
      </Button>
    </Tooltip>
  );
}

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
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center pb-4">
        <div
          data-testid="home-dock"
          data-placement="bottom"
          className="pointer-events-auto flex items-center gap-1 rounded-2xl border bg-sidebar/70 p-1.5 shadow-xl backdrop-blur-md"
        >
          {items}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative z-10 flex w-20 shrink-0 items-center justify-center",
        isMac && !fullscreen && "pt-7",
      )}
    >
      <div
        data-testid="home-dock"
        data-placement="left"
        className="pointer-events-auto flex flex-col items-center gap-1 rounded-2xl border bg-sidebar/70 p-1.5 shadow-xl backdrop-blur-md"
      >
        {items}
      </div>
    </div>
  );
}
