import { Children, Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Globe,
  SlidersHorizontal,
  GitFork,
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
import { ThemeMenu, THEME_PREFERENCES, themePreferenceLabel, themeMenuLabel } from "@/components/layout/ThemeControls";
import { ToolbarAction } from "@/components/layout/ToolbarAction";
import { TOOLBAR_OVERFLOW } from "@/lib/use-toolbar-layout";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuPortal, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import type { ThemePreference } from "@/lib/theme";
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
    "size-7 text-muted-foreground hover:text-foreground",
    active && "bg-primary/10 text-foreground hover:bg-primary/10",
  );

const RAIL_TAB_SHORTCUT: Record<string, string> = {
  refs: shortcut("Shift-F12"),
};

function ViewButton({
  tab,
  ctx,
  active,
  onSelect,
}: Readonly<{
  tab: RailTabContribution;
  ctx: AppContext;
  active: boolean;
  onSelect: () => void;
}>) {
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
          <output
            aria-label={t(($) => $.shell.rail.pendingBadge, { count: badge })}
            className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-white border border-background"
          >
            {badge > 99 ? "99+" : badge}
          </output>
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

export function WorkspaceDockControls({ onFork, layoutControl, children, overflow = TOOLBAR_OVERFLOW.fork }: Readonly<{
  onFork?: () => void;
  layoutControl?: ReactNode;
  children?: ReactNode;
  overflow?: number;
}>) {
  const hideBrowser = overflow >= TOOLBAR_OVERFLOW.browser;
  const hideTheme = overflow >= TOOLBAR_OVERFLOW.theme;
  const hideSettings = overflow >= TOOLBAR_OVERFLOW.settings;
  const hideFork = overflow >= TOOLBAR_OVERFLOW.fork;
  const { preference, setPreference } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const pointerToggled = useRef(false);
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: Resizing changes which actions this menu owns.
  useEffect(() => setMenuOpen(false), [overflow]);

  return (
    <div className="contents">
      <ToolbarAction name="terminal">
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
      </ToolbarAction>
      {layoutControl}
      {webBrowser && <ToolbarAction name="browser" order={TOOLBAR_OVERFLOW.browser} hidden={hideBrowser}>
        <Tooltip label={browserLabel} side="bottom">
          <Button type="button" variant="ghost" size="icon" className={dockBtn(browserOpen)}
            aria-label={browserLabel} aria-pressed={browserOpen} data-testid={hideBrowser ? undefined : "rail-browser-toggle"}
            onClick={() => toggleBrowser()}><Globe className="size-4" aria-hidden /></Button>
        </Tooltip>
      </ToolbarAction>}
      <ToolbarAction name="assistant">
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
      </ToolbarAction>
      <ToolbarAction name="theme" order={TOOLBAR_OVERFLOW.theme} hidden={hideTheme}>
        <ThemeMenu key={hideTheme ? "hidden" : "visible"} triggerClassName={dockBtn(false)} />
      </ToolbarAction>
      <ToolbarAction name="settings" order={TOOLBAR_OVERFLOW.settings} hidden={hideSettings}>
        <Tooltip label={t(($) => $.shell.dock.settings)} side="bottom">
          <Button type="button" variant="ghost" size="icon" className={dockBtn(false)}
            data-testid={hideSettings ? undefined : "open-settings"} aria-label={t(($) => $.shell.dock.settings)}
            onClick={() => setSettingsOpen(true)}><SettingsIcon className="size-4" /></Button>
        </Tooltip>
      </ToolbarAction>
      <ToolbarAction name="menu" hidden={overflow === 0}>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t(($) => $.shell.toolbar.moreActions)} data-testid="workspace-menu" className={dockBtn(false)}
            onPointerDown={() => { pointerToggled.current = true; }}
            onClick={() => {
              if (pointerToggled.current) { pointerToggled.current = false; return; }
              setMenuOpen((open) => !open);
            }}>
            <SlidersHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {children}
          {Children.toArray(children).length > 0 && <DropdownMenuSeparator />}
          {onFork && hideFork && <DropdownMenuItem onSelect={onFork}>
            <GitFork className="size-4" />{t(($) => $.shell.toolbar.forkProject)}
          </DropdownMenuItem>}
          {webBrowser && hideBrowser && <DropdownMenuItem data-testid="rail-browser-toggle" onSelect={() => toggleBrowser()}>
            <Globe className="size-4" />{browserLabel}
          </DropdownMenuItem>}
          {hideTheme && <DropdownMenuSub>
            <DropdownMenuSubTrigger>{themeMenuLabel(preference)}</DropdownMenuSubTrigger>
            <DropdownMenuPortal><DropdownMenuSubContent>
              <DropdownMenuRadioGroup value={preference} onValueChange={(value) => setPreference(value as ThemePreference)}>
                {THEME_PREFERENCES.map((value) => (
                  <DropdownMenuRadioItem key={value} value={value} data-testid={`theme-option-${value}`}>
                    {themePreferenceLabel(value)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent></DropdownMenuPortal>
          </DropdownMenuSub>}
          {hideSettings && <DropdownMenuItem data-testid="open-settings" onSelect={() => setSettingsOpen(true)}>
            <SettingsIcon className="size-4" />{t(($) => $.shell.dock.settings)}
          </DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
      </ToolbarAction>
    </div>
  );
}
