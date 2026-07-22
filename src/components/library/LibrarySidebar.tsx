import { useEffect, useState, type RefObject } from "react";
import { Clock3, FileInput, Moon, Plus, Sun } from "lucide-react";
import { LeafLogo } from "@/components/layout/LeafLogo";
import { SettingsMenu } from "@/components/layout/SettingsMenu";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn, isMac } from "@/lib/utils";
import { useTheme } from "@/lib/theme";
import { useDeadlinesStore } from "@/store/deadlines";
import { useSettingsStore } from "@/store/settings";

const COLLAPSE_KEY = "oleafly.librarySidebarCollapsed";

export function useLibrarySidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(COLLAPSE_KEY) === "1",
  );
  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
  }, [collapsed]);
  return { collapsed, toggle: () => setCollapsed((v) => !v) };
}

function NavItem({
  collapsed,
  label,
  icon,
  onClick,
  primary = false,
  testId,
  tour,
}: {
  collapsed: boolean;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  testId?: string;
  tour?: string;
}) {
  const button = (
    <Button
      data-testid={testId}
      data-tour={tour}
      variant={primary ? "default" : "ghost"}
      size="sm"
      className={cn(
        collapsed ? "size-9 justify-center p-0" : "w-full justify-start gap-2.5 px-2.5",
        "text-[13px] font-medium",
        !primary && "text-muted-foreground hover:text-foreground",
      )}
      onClick={onClick}
    >
      {icon}
      {!collapsed && label}
    </Button>
  );
  return collapsed ? <Tooltip label={label}>{button}</Tooltip> : button;
}

/** Home-screen navigation sidebar (shadcn sidebar pattern, icon-collapsible). */
export function LibrarySidebar({
  importInputRef,
  collapsed,
}: {
  importInputRef: RefObject<HTMLInputElement | null>;
  collapsed: boolean;
}) {
  const setNewProjectOpen = useSettingsStore((s) => s.setNewProjectOpen);
  const { theme, toggleTheme } = useTheme();

  return (
    <aside
      data-testid="library-sidebar"
      data-collapsed={collapsed ? "true" : "false"}
      className={cn(
        "relative z-10 flex shrink-0 flex-col border-r bg-sidebar/60 backdrop-blur-sm transition-[width] duration-200",
        collapsed ? "w-14" : "w-56",
      )}
    >
      <div
        className={cn(
          "flex h-12 items-center gap-2",
          collapsed ? "justify-center" : "px-4",
          isMac && "mt-7",
        )}
        data-tauri-drag-region
      >
        <LeafLogo className="size-5" />
        {!collapsed && <span className="text-sm font-semibold tracking-tight">Oleafly</span>}
      </div>
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
          label="PDF to LaTeX"
          icon={<FileInput className="size-4" />}
          onClick={() => importInputRef.current?.click()}
          testId="import-pdf"
        />
        <NavItem
          collapsed={collapsed}
          label="CCF Deadlines"
          icon={<Clock3 className="size-4" />}
          onClick={() => void useDeadlinesStore.getState().openView()}
          testId="open-deadlines"
        />
      </nav>
      <div
        className={cn(
          "mt-auto flex gap-1 border-t p-2",
          collapsed ? "flex-col items-center" : "items-center",
        )}
      >
        <Tooltip label="Settings">
          <SettingsMenu />
        </Tooltip>
        <Tooltip label={theme === "dark" ? "Light theme" : "Dark theme"}>
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
      </div>
    </aside>
  );
}
