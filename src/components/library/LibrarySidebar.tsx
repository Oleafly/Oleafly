import type { RefObject } from "react";
import { Clock3, FileInput, Moon, Plus, Sun } from "lucide-react";
import { LeafLogo } from "@/components/layout/LeafLogo";
import { SettingsMenu } from "@/components/layout/SettingsMenu";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip } from "@/components/ui/tooltip";
import { useTheme } from "@/lib/theme";
import { useDeadlinesStore } from "@/store/deadlines";
import { useSettingsStore } from "@/store/settings";

/** Home-screen navigation sidebar (shadcn sidebar pattern, static). */
export function LibrarySidebar({
  importInputRef,
}: {
  importInputRef: RefObject<HTMLInputElement | null>;
}) {
  const setNewProjectOpen = useSettingsStore((s) => s.setNewProjectOpen);
  const { theme, toggleTheme } = useTheme();

  const item =
    "w-full justify-start gap-2.5 px-2.5 text-[13px] font-medium text-muted-foreground hover:text-foreground";

  return (
    <aside
      data-testid="library-sidebar"
      className="relative z-10 flex w-56 shrink-0 flex-col border-r bg-sidebar/60 backdrop-blur-sm"
    >
      <div className="flex h-12 items-center gap-2 px-4" data-tauri-drag-region>
        <LeafLogo className="size-5" />
        <span className="text-sm font-semibold tracking-tight">Oleafly</span>
      </div>
      <Separator />
      <nav className="flex flex-col gap-0.5 p-2" aria-label="Library">
        <Button
          data-testid="new-project"
          data-tour="new-project"
          variant="ghost"
          size="sm"
          className={item}
          onClick={() => setNewProjectOpen(true)}
        >
          <Plus className="size-4" /> New project
        </Button>
        <Button
          data-testid="import-pdf"
          variant="ghost"
          size="sm"
          className={item}
          onClick={() => importInputRef.current?.click()}
        >
          <FileInput className="size-4" /> PDF to LaTeX
        </Button>
        <Button
          data-testid="open-deadlines"
          variant="ghost"
          size="sm"
          className={item}
          onClick={() => void useDeadlinesStore.getState().openView()}
        >
          <Clock3 className="size-4" /> CCF Deadlines
        </Button>
      </nav>
      <div className="mt-auto flex items-center gap-1 border-t p-2">
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
