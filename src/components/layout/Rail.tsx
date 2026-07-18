import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  BookOpen,
  CircleHelp,
  Mail,
  Moon,
  PanelLeft,
  PanelLeftClose,
  Settings as SettingsIcon,
  Sun,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { railSections, type AppContext, type RailTabContribution } from "@openleaf/registry";
import { useSettingsStore, type RailTab } from "@/store/settings";
import { useFilesStore } from "@/store/files";
import { useMcpActivityStore } from "@/store/mcp-activity";
import { useTheme } from "@/lib/theme";
import { Tooltip } from "@/components/ui/tooltip";
import { AboutModal } from "@/components/layout/AboutModal";
import { cn } from "@/lib/utils";

const railBtn = (active: boolean) =>
  cn(
    "flex size-9 items-center justify-center rounded-md transition-colors",
    active
      ? "bg-accent text-foreground"
      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
  );

// Its own component so useBadge (a hook) has a stable call site per tab.
function RailTabButton({
  tab,
  active,
  onSelect,
}: {
  tab: RailTabContribution;
  active: boolean;
  onSelect: () => void;
}) {
  const badge = tab.useBadge?.() ?? 0;
  const Icon = tab.icon;
  return (
    <Tooltip label={tab.label} side="right">
      <button
        type="button"
        aria-label={tab.label}
        aria-current={active ? "page" : undefined}
        onClick={onSelect}
        className={cn("relative", railBtn(active))}
      >
        <Icon className="size-5" aria-hidden />
        {badge > 0 && (
          <span
            role="status"
            aria-label={`${badge} pending`}
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-white ring-2 ring-muted/30"
          >
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </button>
    </Tooltip>
  );
}

export function Rail() {
  const railTab = useSettingsStore((s) => s.railTab);
  const projectId = useFilesStore((s) => s.projectId);
  const projectKind = useFilesStore((s) => s.projectKind);
  const setRailTab = useSettingsStore((s) => s.setRailTab);
  const showTree = useSettingsStore((s) => s.showTree);
  const toggleTree = useSettingsStore((s) => s.toggleTree);
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen);
  const mcpEnabled = useMcpActivityStore((s) => s.serverRunning);
  const { theme, toggleTheme } = useTheme();
  const [helpOpen, setHelpOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  // Native "About OpenLeaf" menu item triggers this via a Tauri event.
  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = listen("menu://about", () => setAboutOpen(true));
    return () => void unlisten.then((off) => off());
  }, []);

  // MCP activity tab disappears when the server stops; leave the rail cleanly.
  useEffect(() => {
    if (!mcpEnabled && railTab === "mcp") setRailTab("files");
  }, [mcpEnabled, railTab, setRailTab]);

  const select = (tab: RailTab) => {
    if (tab === railTab && showTree) {
      toggleTree();
    } else {
      setRailTab(tab);
      if (!showTree) toggleTree();
    }
  };

  const ctx: AppContext = { projectId, projectKind, theme, mcpEnabled };
  const sections = railSections(ctx);

  return (
    <nav
      aria-label="Sidebar"
      className="flex w-12 shrink-0 flex-col items-center border-r bg-muted/30 py-2"
    >
      <div className="flex flex-1 flex-col items-center gap-1">
        {sections.map((tabs, i) => (
          <div key={tabs[0]?.section ?? i} className="flex flex-col items-center gap-1">
            {i > 0 && <span className="mb-1 mt-1 h-px w-6 bg-border" />}
            {tabs.map((tab) => (
              <RailTabButton
                key={tab.id}
                tab={tab}
                active={railTab === tab.id && showTree}
                onSelect={() => select(tab.id as RailTab)}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="flex flex-col items-center gap-1">
        <Tooltip label={showTree ? "Hide sidebar" : "Show sidebar"} side="right">
          <button type="button"
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
            <button type="button"
              aria-label="Help"
              onClick={() => setHelpOpen((v) => !v)}
              className={railBtn(false)}
            >
              <CircleHelp className="size-5" />
            </button>
            {helpOpen && (
              <>
                <button type="button" aria-label="Close help menu" className="fixed inset-0 z-40" onClick={() => setHelpOpen(false)} />
                <div className="absolute bottom-0 left-full z-50 ml-2 w-44 rounded-md border bg-popover p-1 text-popover-foreground shadow-xl">
                  <button type="button"
                    onClick={() => { setHelpOpen(false); void open("https://www.overleaf.com/learn"); }}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <BookOpen className="size-4 text-muted-foreground" /> Documentation
                  </button>
                  <button type="button"
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
          <button type="button"
            aria-label="Toggle theme"
            onClick={toggleTheme}
            className={railBtn(false)}
          >
            {theme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
          </button>
        </Tooltip>
        <Tooltip label="Settings" side="right">
          <button type="button"
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
