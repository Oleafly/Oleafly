import { Fragment, useEffect } from "react";
import {
  Globe,
  PanelLeft,
  PanelLeftClose,
  Settings as SettingsIcon,
  Sparkles,
  SquareTerminal,
} from "lucide-react";
import { railSections, type AppContext, type RailTabContribution } from "@oleafly/registry";
import { useSettingsStore, type RailTab } from "@/store/settings";
import { useFilesStore } from "@/store/files";
import { useMcpActivityStore } from "@/store/mcp-activity";
import { shortcutLabel, useShortcutStore } from "@/store/shortcuts";
import { useTheme } from "@/lib/theme";
import { toggleBrowser } from "@/lib/browser-window";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { ThemeMenu } from "@/components/layout/ThemeControls";
import { cn } from "@/lib/utils";

const ctrlBtn = (active: boolean) =>
  cn(
    "flex size-7 shrink-0 items-center justify-center rounded-md transition-colors",
    active
      ? "bg-primary/10 text-foreground"
      : "text-muted-foreground hover:bg-accent hover:text-foreground",
  );

const dockBtn = (active: boolean) =>
  cn(
    "text-muted-foreground hover:text-foreground",
    active && "bg-primary/10 text-foreground hover:bg-primary/10",
  );

function DockDivider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-border" />;
}

function ViewButton({
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
    <Tooltip label={tab.label} side="bottom">
      <button
        type="button"
        aria-label={tab.label}
        aria-current={active ? "page" : undefined}
        onClick={onSelect}
        className={cn("relative", ctrlBtn(active))}
      >
        <Icon className="size-4" aria-hidden />
        {badge > 0 && (
          <span
            role="status"
            aria-label={`${badge} pending`}
            className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-white ring-1 ring-background"
          >
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </button>
    </Tooltip>
  );
}

export function SidebarViews() {
  const railTab = useSettingsStore((s) => s.railTab);
  const projectId = useFilesStore((s) => s.projectId);
  const projectKind = useFilesStore((s) => s.projectKind);
  const setRailTab = useSettingsStore((s) => s.setRailTab);
  const showTree = useSettingsStore((s) => s.showTree);
  const toggleTree = useSettingsStore((s) => s.toggleTree);
  const mcpEnabled = useMcpActivityStore((s) => s.serverRunning);
  const { theme } = useTheme();

  useEffect(() => {
    if (!mcpEnabled && railTab === "mcp") setRailTab("files");
  }, [mcpEnabled, railTab, setRailTab]);

  const select = (tab: RailTab) => {
    setRailTab(tab);
    if (!showTree) toggleTree();
  };

  const ctx: AppContext = { projectId, projectKind, theme, mcpEnabled };
  const tabs = railSections(ctx).flat();

  return (
    <div data-tour="project-sidebar" className="flex items-center gap-0.5">
      {tabs.map((tab, i) => (
        <Fragment key={tab.id}>
          {i > 0 && <span className="mx-0.5 h-5 w-px shrink-0 bg-border" />}
          <ViewButton
            tab={tab}
            active={railTab === tab.id}
            onSelect={() => select(tab.id as RailTab)}
          />
        </Fragment>
      ))}
    </div>
  );
}

export function SidebarCollapseToggle() {
  const showTree = useSettingsStore((s) => s.showTree);
  const toggleTree = useSettingsStore((s) => s.toggleTree);
  const shortcut = useShortcutStore((s) => shortcutLabel(s.bindings.toggleSidebar));
  const label = `${showTree ? "Hide" : "Show"} sidebar (${shortcut})`;
  return (
    <Tooltip label={label} side="bottom">
      <button
        type="button"
        aria-label={label}
        onClick={toggleTree}
        className={ctrlBtn(false)}
      >
        {showTree ? <PanelLeftClose className="size-4" /> : <PanelLeft className="size-4" />}
      </button>
    </Tooltip>
  );
}

export function WorkspaceDockControls() {
  const terminalOpen = useSettingsStore((s) => s.terminalOpen);
  const setTerminalOpen = useSettingsStore((s) => s.setTerminalOpen);
  const webBrowser = useSettingsStore((s) => s.webBrowser);
  const browserOpen = useSettingsStore((s) => s.browserOpen);
  const assistantOpen = useSettingsStore((s) => s.assistantOpen);
  const setAssistantOpen = useSettingsStore((s) => s.setAssistantOpen);
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen);
  const terminalShortcut = useShortcutStore((s) => shortcutLabel(s.bindings.toggleTerminal));
  const browserShortcut = useShortcutStore((s) => shortcutLabel(s.bindings.toggleBrowser));
  const terminalLabel = `${terminalOpen ? "Hide" : "Show"} terminal (${terminalShortcut})`;
  // The browser opens in its own window; the button toggles that window.
  const browserLabel = `${browserOpen ? "Close" : "Open"} browser (${browserShortcut})`;
  const assistantLabel = `${assistantOpen ? "Hide" : "Show"} AI assistant`;

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Tooltip label={terminalLabel} side="bottom">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-testid="rail-terminal-toggle"
          aria-label={terminalLabel}
          aria-pressed={terminalOpen}
          onClick={() => setTerminalOpen(!terminalOpen)}
          className={dockBtn(terminalOpen)}
        >
          <SquareTerminal className="size-4" aria-hidden />
        </Button>
      </Tooltip>
      {webBrowser && (
        <Tooltip label={browserLabel} side="bottom">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-testid="rail-browser-toggle"
            aria-label={browserLabel}
            aria-pressed={browserOpen}
            onClick={() => toggleBrowser()}
            className={dockBtn(browserOpen)}
          >
            <Globe className="size-4" aria-hidden />
          </Button>
        </Tooltip>
      )}
      <Tooltip label={assistantLabel} side="bottom">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-testid="rail-assistant-toggle"
          aria-label={assistantLabel}
          aria-pressed={assistantOpen}
          onClick={() => setAssistantOpen(!assistantOpen)}
          className={dockBtn(assistantOpen)}
        >
          <Sparkles className="size-4" aria-hidden />
        </Button>
      </Tooltip>
      <DockDivider />
      <ThemeMenu triggerClassName={dockBtn(false)} />
      <Tooltip label="Settings" side="bottom">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Settings"
          onClick={() => setSettingsOpen(true)}
          className={dockBtn(false)}
        >
          <SettingsIcon className="size-4" />
        </Button>
      </Tooltip>
    </div>
  );
}
