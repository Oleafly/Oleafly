import { Fragment, useEffect } from "react";
import {
  Globe,
  PanelLeft,
  PanelLeftClose,
  Settings as SettingsIcon,
  Sparkles,
  SquareTerminal,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { railSections, railTabLabel, type AppContext, type RailTabContribution } from "@oleafly/registry";
import { useSettingsStore, type RailTab } from "@/store/settings";
import { useFilesStore } from "@/store/files";
import { useMcpActivityStore } from "@/store/mcp-activity";
import { shortcutLabel, useShortcutStore } from "@/store/shortcuts";
import { useTheme } from "@/lib/theme";
import { toggleBrowser } from "@/lib/browser-window";
import { BetaBadge } from "@/components/ui/beta-badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { ThemeMenu } from "@/components/layout/ThemeControls";
import { cn, shortcut } from "@/lib/utils";

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

const RAIL_TAB_SHORTCUT: Record<string, string> = {
  refs: shortcut("Shift-F12"),
};

function ViewButton({
  tab,
  ctx,
  active,
  onSelect,
}: {
  tab: RailTabContribution;
  ctx: AppContext;
  active: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation(["shell"]);
  const badge = tab.useBadge?.() ?? 0;
  const Icon = tab.icon;
  const hotkey = RAIL_TAB_SHORTCUT[tab.id];
  const label = railTabLabel(tab, ctx);
  const name = hotkey ? t(($) => $.shell.rail.withShortcut, { label, shortcut: hotkey }) : label;
  const tooltip = tab.beta ? t(($) => $.shell.rail.betaTab, { label: name }) : name;
  return (
    <Tooltip label={tooltip} side="bottom">
      <button
        type="button"
        data-tour={`rail-${tab.id}`}
        aria-label={name}
        aria-current={active ? "page" : undefined}
        onClick={onSelect}
        className={cn("relative", ctrlBtn(active))}
      >
        <Icon className="size-4" aria-hidden />
        {tab.beta ? (
          <BetaBadge className="pointer-events-none absolute -right-5 -top-1 border-background bg-primary px-1 text-[8px] leading-[13px] text-primary-foreground" />
        ) : null}
        {badge > 0 && (
          <span
            role="status"
            aria-label={t(($) => $.shell.rail.pendingBadge, { count: badge })}
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
            ctx={ctx}
            active={railTab === tab.id}
            onSelect={() => select(tab.id as RailTab)}
          />
        </Fragment>
      ))}
    </div>
  );
}

export function SidebarCollapseToggle() {
  const { t } = useTranslation(["shell"]);
  const showTree = useSettingsStore((s) => s.showTree);
  const toggleTree = useSettingsStore((s) => s.toggleTree);
  const shortcut = useShortcutStore((s) => shortcutLabel(s.bindings.toggleSidebar));
  const label = showTree
    ? t(($) => $.shell.dock.sidebar.hide, { shortcut })
    : t(($) => $.shell.dock.sidebar.show, { shortcut });
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
  const { t } = useTranslation(["shell"]);
  const terminalOpen = useSettingsStore((s) => s.terminalOpen);
  const setTerminalOpen = useSettingsStore((s) => s.setTerminalOpen);
  const webBrowser = useSettingsStore((s) => s.webBrowser);
  const browserOpen = useSettingsStore((s) => s.browserOpen);
  const assistantOpen = useSettingsStore((s) => s.assistantOpen);
  const setAssistantOpen = useSettingsStore((s) => s.setAssistantOpen);
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen);
  const terminalShortcut = useShortcutStore((s) => shortcutLabel(s.bindings.toggleTerminal));
  const browserShortcut = useShortcutStore((s) => shortcutLabel(s.bindings.toggleBrowser));
  const terminalLabel = terminalOpen
    ? t(($) => $.shell.dock.terminal.hide, { shortcut: terminalShortcut })
    : t(($) => $.shell.dock.terminal.show, { shortcut: terminalShortcut });
  // The browser opens in its own window; the button toggles that window.
  const browserLabel = browserOpen
    ? t(($) => $.shell.dock.browser.close, { shortcut: browserShortcut })
    : t(($) => $.shell.dock.browser.open, { shortcut: browserShortcut });
  const assistantLabel = assistantOpen
    ? t(($) => $.shell.dock.assistant.hide)
    : t(($) => $.shell.dock.assistant.show);

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
      <DockDivider />
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
      {webBrowser && <DockDivider />}
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
      <Tooltip label={t(($) => $.shell.dock.settings)} side="bottom">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-testid="open-settings"
          aria-label={t(($) => $.shell.dock.settings)}
          onClick={() => setSettingsOpen(true)}
          className={dockBtn(false)}
        >
          <SettingsIcon className="size-4" />
        </Button>
      </Tooltip>
    </div>
  );
}
