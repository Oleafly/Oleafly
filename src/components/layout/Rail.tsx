import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  BookOpen,
  CircleHelp,
  FileText,
  GitBranch,
  Mail,
  Moon,
  PanelLeft,
  PanelLeftClose,
  Search,
  SearchCode,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Sun,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { useSettingsStore, type RailTab } from "@/store/settings";
import { useGitStatusStore } from "@/store/git-status";
import { useTheme } from "@/lib/theme";
import { Tooltip } from "@/components/ui/tooltip";
import { AboutModal } from "@/components/layout/AboutModal";
import { cn } from "@/lib/utils";

const TOP_TABS: { id: RailTab; label: string; icon: typeof FileText }[] = [
  { id: "files", label: "Source Tree", icon: FileText },
  { id: "search", label: "Project search", icon: Search },
  { id: "source", label: "Git", icon: GitBranch },
];

export function Rail() {
  const railTab = useSettingsStore((s) => s.railTab);
  const setRailTab = useSettingsStore((s) => s.setRailTab);
  const showTree = useSettingsStore((s) => s.showTree);
  const toggleTree = useSettingsStore((s) => s.toggleTree);
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen);
  const { theme, toggleTheme } = useTheme();
  const gitCount = useGitStatusStore((s) => s.count);
  const [helpOpen, setHelpOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  // "About OpenLeaf" in the app menu opens our in-app About dialog.
  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = listen("menu://about", () => setAboutOpen(true));
    return () => void unlisten.then((off) => off());
  }, []);

  const select = (tab: RailTab) => {
    if (tab === railTab && showTree) {
      toggleTree(); // collapse sidebar when re-clicking the active tab
    } else {
      setRailTab(tab);
      if (!showTree) toggleTree();
    }
  };

  const railBtn = (active: boolean) =>
    cn(
      "flex size-9 items-center justify-center rounded-md transition-colors",
      active
        ? "bg-accent text-foreground"
        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
    );

  return (
    <nav
      aria-label="Sidebar"
      className="flex w-12 shrink-0 flex-col items-center border-r bg-muted/30 py-2"
    >
      <div className="flex flex-1 flex-col items-center gap-1">
        {TOP_TABS.map(({ id, label, icon: Icon }) => (
          <Tooltip key={id} label={label} side="right">
            <button
              aria-label={label}
              onClick={() => select(id)}
              className={cn("relative", railBtn(railTab === id && showTree))}
            >
              <Icon className="size-5" />
              {id === "source" && gitCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-white ring-2 ring-muted/30">
                  {gitCount > 99 ? "99+" : gitCount}
                </span>
              )}
            </button>
          </Tooltip>
        ))}

        <span className="my-1 h-px w-6 bg-border" />

        <Tooltip label="Preflight (ATS + accessibility)" side="right">
          <button
            aria-label="Preflight"
            onClick={() => select("preflight")}
            className={railBtn(railTab === "preflight" && showTree)}
          >
            <ShieldCheck className="size-5" />
          </button>
        </Tooltip>

        <Tooltip label="References (Shift-F12)" side="right">
          <button
            aria-label="References"
            onClick={() => select("refs")}
            className={railBtn(railTab === "refs" && showTree)}
          >
            <SearchCode className="size-5" />
          </button>
        </Tooltip>

        <span className="my-1 h-px w-6 bg-border" />

        <Tooltip label="Chat / AI Assistant" side="right">
          <button
            aria-label="Chat"
            onClick={() => select("ai")}
            className={railBtn(railTab === "ai" && showTree)}
          >
            <Sparkles className="size-5" />
          </button>
        </Tooltip>
      </div>

      <div className="flex flex-col items-center gap-1">
        <Tooltip label={showTree ? "Hide sidebar" : "Show sidebar"} side="right">
          <button
            aria-label={showTree ? "Hide sidebar" : "Show sidebar"}
            onClick={toggleTree}
            className={railBtn(false)}
          >
            {showTree ? (
              <PanelLeftClose className="size-5" />
            ) : (
              <PanelLeft className="size-5" />
            )}
          </button>
        </Tooltip>
        <Tooltip label="Help" side="right">
          <div className="relative">
            <button
              aria-label="Help"
              onClick={() => setHelpOpen((v) => !v)}
              className={railBtn(false)}
            >
              <CircleHelp className="size-5" />
            </button>
            {helpOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setHelpOpen(false)} />
                <div className="absolute bottom-0 left-full z-50 ml-2 w-44 rounded-md border bg-popover p-1 text-popover-foreground shadow-xl">
                  <button
                    onClick={() => { setHelpOpen(false); void open("https://www.overleaf.com/learn"); }}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <BookOpen className="size-4 text-muted-foreground" /> Documentation
                  </button>
                  <button
                    onClick={() => { setHelpOpen(false); setAboutOpen(true); }}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <Mail className="size-4 text-muted-foreground" /> Contact us
                  </button>
                </div>
              </>
            )}
          </div>
        </Tooltip>
        <Tooltip label={theme === "dark" ? "Light theme" : "Dark theme"} side="right">
          <button
            aria-label="Toggle theme"
            onClick={toggleTheme}
            className={railBtn(false)}
          >
            {theme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
          </button>
        </Tooltip>
        <Tooltip label="Settings" side="right">
          <button
            aria-label="Settings"
            onClick={() => setSettingsOpen(true)}
            className={railBtn(false)}
          >
            <SettingsIcon className="size-5" />
          </button>
        </Tooltip>
      </div>

      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </nav>
  );
}
