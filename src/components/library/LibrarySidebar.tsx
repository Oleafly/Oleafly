import { Clock3, Moon, Plus, Sun, Wrench } from "lucide-react";
import { LeafLogo } from "@/components/layout/LeafLogo";
import { SettingsMenu } from "@/components/layout/SettingsMenu";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn, isMac } from "@/lib/utils";
import { useFullscreen } from "@/lib/use-fullscreen";
import { useTheme } from "@/lib/theme";
import { useDeadlinesStore } from "@/store/deadlines";
import { useHomeViewStore } from "@/store/home-view";
import { useSettingsStore } from "@/store/settings";

export { useLibrarySidebarStore as useLibrarySidebarCollapsed } from "@/store/library-sidebar";

function NavItem({
  collapsed,
  label,
  icon,
  onClick,
  primary = false,
  active = false,
  testId,
  tour,
}: {
  collapsed: boolean;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  active?: boolean;
  testId?: string;
  tour?: string;
}) {
  const button = (
    <Button
      data-testid={testId}
      data-tour={tour}
      data-active={active ? "true" : "false"}
      variant={primary ? "default" : active ? "secondary" : "ghost"}
      size="sm"
      className={cn(
        collapsed ? "size-9 justify-center p-0" : "w-full justify-start gap-2.5 px-2.5",
        "text-[13px] font-medium",
        !primary && !active && "text-muted-foreground hover:text-foreground",
      )}
      onClick={onClick}
    >
      {icon}
      {!collapsed && label}
    </Button>
  );
  return collapsed ? (
    <Tooltip label={label} side="right">
      {button}
    </Tooltip>
  ) : (
    button
  );
}

/** Home-shell navigation sidebar (shadcn sidebar pattern, icon-collapsible).
 *  Shared across the library, deadlines, PDF-import, and LaTeX-tools pages;
 *  each mounts its own instance (only one page is ever rendered at a time,
 *  gated by useHomeViewStore.page), so collapse state (persisted in
 *  useLibrarySidebarStore) stays in sync across all of them. */
export function LibrarySidebar({ collapsed }: { collapsed: boolean }) {
  const setNewProjectOpen = useSettingsStore((s) => s.setNewProjectOpen);
  const { theme, toggleTheme } = useTheme();
  const fullscreen = useFullscreen();
  const page = useHomeViewStore((s) => s.page);
  const goTo = useHomeViewStore((s) => s.goTo);

  return (
    <aside
      data-testid="library-sidebar"
      data-collapsed={collapsed ? "true" : "false"}
      className={cn(
        "relative z-10 flex shrink-0 flex-col border-r bg-sidebar/60 backdrop-blur-sm transition-[width] duration-200",
        collapsed ? "w-14" : "w-56",
      )}
    >
      <button
        type="button"
        data-testid="sidebar-home"
        onClick={() => goTo("library")}
        aria-label="Home"
        className={cn(
          "flex h-12 items-center gap-2 text-left",
          collapsed ? "justify-center" : "px-4",
          isMac && !fullscreen && "mt-7",
        )}
        data-tauri-drag-region
      >
        <LeafLogo className="size-5" />
        {!collapsed && <span className="text-sm font-semibold tracking-tight">Oleafly</span>}
      </button>
      <nav
        className={cn("flex flex-col gap-1 p-2", collapsed && "items-center")}
        aria-label="Library"
      >
        <NavItem
          collapsed={collapsed}
          label="New project"
          icon={<Plus className="size-4" />}
          onClick={() => setNewProjectOpen(true)}
          primary
          testId="new-project"
          tour="new-project"
        />
        <NavItem
          collapsed={collapsed}
          label="CCF Deadlines"
          icon={<Clock3 className="size-4" />}
          onClick={() => {
            void useDeadlinesStore.getState().openView();
            goTo("deadlines");
          }}
          active={page === "deadlines"}
          testId="open-deadlines"
        />
        <NavItem
          collapsed={collapsed}
          label="LaTeX Tools"
          icon={<Wrench className="size-4" />}
          onClick={() => goTo("latex-tools")}
          active={page === "latex-tools"}
          testId="open-latex-tools"
        />
      </nav>
      <div
        className={cn(
          "mt-auto flex gap-1 border-t p-2",
          collapsed ? "flex-col items-center" : "items-center",
        )}
      >
        <Tooltip label={theme === "dark" ? "Light theme" : "Dark theme"} side="right">
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground"
            onClick={toggleTheme}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
        </Tooltip>
        <Tooltip label="Settings" side="right">
          <SettingsMenu />
        </Tooltip>
      </div>
    </aside>
  );
}
