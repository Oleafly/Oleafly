import { Children, useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  SlidersHorizontal,
  GitFork,
  PanelLeft,
  PanelLeftClose,
  PanelRight,
  PanelRightClose,
  Settings as SettingsIcon,
  SquareTerminal,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { railSections, railTabIds, railTabLabel, type AppContext, type RailTabContribution } from "@oleafly/registry";
import { useSettingsStore, type RailTab } from "@/store/settings";
import { useFilesStore } from "@/store/files";
import { paneSide, usePaneLayoutStore } from "@/store/pane-layout";
import { useTerminalsStore } from "@/store/terminals";
import { useCollabRail } from "@/components/collab/collab-rail";
import { useChatRail } from "@/components/collab/chat-rail";
import { useCommentsRail } from "@/components/collab/comments-rail";
import { shortcutLabel, useShortcutStore } from "@/store/shortcuts";
import { useTheme } from "@/lib/theme";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { intentProps } from "@/lib/preloadable";
import { ThemeMenu, THEME_PREFERENCES, themePreferenceLabel, themeMenuLabel } from "@/components/layout/ThemeControls";
import { ToolbarAction } from "@/components/layout/ToolbarAction";
import { CLOUD_ATTENTION_HINT_ID } from "@/components/cloud/cloud-attention";
import { TOOLBAR_OVERFLOW } from "@/lib/use-toolbar-layout";
import { applyRailOrder, useRailOrder } from "@/components/layout/rail-order";
import { useStripReorder, type StripItemProps } from "@/components/layout/strip-reorder";
import { CONTROL_GAP, ICON_BUTTON_WIDTH, MENU_ACTIVE, MENU_ICON, ToolbarOverflow, type ToolbarControl } from "@/components/ui/toolbar-overflow";
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

const RAIL_DIVIDER_WIDTH = 5;

function RailDivider() {
  return <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-border" />;
}

function useRailBadge(tab: RailTabContribution): number {
  return tab.useBadge?.() ?? 0;
}

const ACTIVITY_DOT = "pointer-events-none absolute right-1 top-1 size-1.5 rounded-full bg-primary";

function HiddenViewDot({ tab }: Readonly<{ tab: RailTabContribution }>) {
  return useRailBadge(tab) > 0 ? <span data-testid="rail-more-badge" aria-hidden className={ACTIVITY_DOT} /> : null;
}

function RailMenuItem({
  tab,
  ctx,
  active,
  onSelect,
}: Readonly<{ tab: RailTabContribution; ctx: AppContext; active: boolean; onSelect: () => void }>) {
  const { t } = useTranslation(["shell"]);
  const badge = useRailBadge(tab);
  const Icon = tab.icon;
  return (
    <DropdownMenuItem onSelect={onSelect} className={cn("gap-2", active && MENU_ACTIVE)}>
      <Icon aria-hidden className={MENU_ICON} />
      <span className="min-w-0 flex-1 truncate">{railTabLabel(tab, ctx)}</span>
      {badge > 0 && (
        <Badge size="sm" aria-label={t(($) => $.shell.rail.pendingBadge, { count: badge })}>
          {badge > 99 ? "99+" : badge}
        </Badge>
      )}
    </DropdownMenuItem>
  );
}

function ViewButton({
  tab,
  ctx,
  active,
  dragging,
  drag,
  onSelect,
}: Readonly<{
  tab: RailTabContribution;
  ctx: AppContext;
  active: boolean;
  dragging: string | null;
  drag: StripItemProps;
  onSelect: () => void;
}>) {
  const { t } = useTranslation(["shell"]);
  const badge = useRailBadge(tab);
  const Icon = tab.icon;
  const hotkey = RAIL_TAB_SHORTCUT[tab.id];
  const label = railTabLabel(tab, ctx);
  const name = hotkey ? t(($) => $.shell.rail.withShortcut, { label, shortcut: hotkey }) : label;
  return (
    <Tooltip label={name} side="bottom" suppressed={dragging !== null}>
      <button
        type="button"
        {...drag}
        data-tour={`rail-${tab.id}`}
        aria-label={name}
        aria-current={active ? "page" : undefined}
        onClick={onSelect}
        className={cn("relative", ctrlBtn(active || dragging === tab.id))}
      >
        <Icon className="size-4" aria-hidden />
        {badge > 0 && (
          <Badge asChild size="count">
            <output aria-label={t(($) => $.shell.rail.pendingBadge, { count: badge })}>{badge > 99 ? "99+" : badge}</output>
          </Badge>
        )}
      </button>
    </Tooltip>
  );
}

export function SidebarViews() {
  const { t } = useTranslation(["shell"]);
  const railTab = useSettingsStore((s) => s.railTab);
  const projectId = useFilesStore((s) => s.projectId);
  const projectKind = useFilesStore((s) => s.projectKind);
  const setRailTab = useSettingsStore((s) => s.setRailTab);
  const showTree = useSettingsStore((s) => s.showTree);
  const toggleTree = useSettingsStore((s) => s.toggleTree);
  const collabShown = useCollabRail((s) => s.visible);
  useCollabRail((s) => s.unread);
  const commentsShown = useCommentsRail((s) => s.visible || s.suggestions);
  useCommentsRail((s) => s.unread);
  const chatShown = useChatRail((s) => s.visible);
  useChatRail((s) => s.unread);
  const { theme } = useTheme();

  useEffect(() => {
    if (!collabShown && railTab === "collab") setRailTab("files");
  }, [collabShown, railTab, setRailTab]);

  useEffect(() => {
    if (!commentsShown && railTab === "comments") setRailTab("files");
  }, [commentsShown, railTab, setRailTab]);

  useEffect(() => {
    if (!chatShown && railTab === "chat") setRailTab("files");
  }, [chatShown, railTab, setRailTab]);

  const notesShown = useSettingsStore((s) => s.notes) && projectKind !== "note";
  useEffect(() => {
    if (!notesShown && railTab === "notes") setRailTab("files");
  }, [notesShown, railTab, setRailTab]);

  const select = (tab: RailTab) => {
    setRailTab(tab);
    if (!showTree) toggleTree();
  };

  const ctx: AppContext = { projectId, projectKind, theme, };
  const [order, setOrder] = useRailOrder(railTabIds());
  const tabs = applyRailOrder(railSections(ctx).flat(), order);
  const reorder = useStripReorder(order, setOrder);

  const controls: ToolbarControl[] = tabs.map((tab, i) => ({
    id: tab.id,
    width: ICON_BUTTON_WIDTH + (i > 0 ? RAIL_DIVIDER_WIDTH + CONTROL_GAP : 0),
    active: railTab === tab.id,
    render: () => (
      <>
        {i > 0 && <RailDivider />}
        <ViewButton
          tab={tab}
          ctx={ctx}
          active={railTab === tab.id}
          dragging={reorder.dragging}
          drag={reorder.item(tab.id)}
          onSelect={() => select(tab.id as RailTab)}
        />
      </>
    ),
    renderMenu: () => (
      <RailMenuItem tab={tab} ctx={ctx} active={railTab === tab.id} onSelect={() => select(tab.id as RailTab)} />
    ),
  }));

  return (
    <div {...reorder.strip} data-tour="project-sidebar" className="relative flex h-full min-w-0 flex-1 items-center">
      <ToolbarOverflow
        controls={controls}
        label={t(($) => $.shell.rail.more)}
        className="h-full"
        showAllUntilMeasured
        moreBadge={(hidden) =>
          hidden.map((control) => {
            const tab = tabs.find((candidate) => candidate.id === control.id);
            return tab ? <HiddenViewDot key={tab.id} tab={tab} /> : null;
          })
        }
      />
      {reorder.indicator}
    </div>
  );
}

function sidebarIcon(shown: boolean, side: "left" | "right") {
  if (side === "right") return shown ? <PanelRightClose className="size-4" /> : <PanelRight className="size-4" />;
  return shown ? <PanelLeftClose className="size-4" /> : <PanelLeft className="size-4" />;
}

export function SidebarCollapseToggle() {
  const { t } = useTranslation(["shell"]);
  const showTree = useSettingsStore((s) => s.showTree);
  const toggleTree = useSettingsStore((s) => s.toggleTree);
  const sidebarSide = usePaneLayoutStore((s) => paneSide(s.layout, "sidebar"));
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
        {sidebarIcon(showTree, sidebarSide)}
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
  const hideTheme = overflow >= TOOLBAR_OVERFLOW.theme;
  const hideSettings = overflow >= TOOLBAR_OVERFLOW.settings;
  const hideFork = overflow >= TOOLBAR_OVERFLOW.fork;
  const { preference, setPreference } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const pointerToggled = useRef(false);
  const { t } = useTranslation(["shell", "workspace"]);
  const terminalOpen = useSettingsStore((s) => s.terminalOpen);
  const setTerminalOpen = useSettingsStore((s) => s.setTerminalOpen);
  const terminalActivity = useTerminalsStore((s) => s.tabs.some((tab) => tab.bell));
  const terminalActivityId = useId();
  const showTerminalActivity = terminalActivity && !terminalOpen;
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen);
  const terminalShortcut = useShortcutStore((s) => shortcutLabel(s.bindings.toggleTerminal));
  const settingsShortcut = useShortcutStore((s) => shortcutLabel(s.bindings.openSettings));
  const terminalLabel = terminalOpen
    ? t(($) => $.shell.dock.terminal.hide, { shortcut: terminalShortcut })
    : t(($) => $.shell.dock.terminal.show, { shortcut: terminalShortcut });
  const settingsLabel = t(($) => $.shell.rail.withShortcut, {
    label: t(($) => $.shell.dock.settings),
    shortcut: settingsShortcut,
  });

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
          aria-describedby={showTerminalActivity ? terminalActivityId : undefined}
          onClick={() => setTerminalOpen(!terminalOpen)}
          className={cn(dockBtn(terminalOpen), "relative")}
        >
          <SquareTerminal className="size-4" aria-hidden />
          {showTerminalActivity && (
            <>
              <span
                data-testid="rail-terminal-activity"
                aria-hidden
                className={ACTIVITY_DOT}
              />
              <span id={terminalActivityId} className="sr-only">
                {t(($) => $.workspace.terminal.activity)}
              </span>
            </>
          )}
        </Button>
      </Tooltip>
      </ToolbarAction>
      {layoutControl}

      <ToolbarAction name="theme" order={TOOLBAR_OVERFLOW.theme} hidden={hideTheme}>
        <ThemeMenu key={hideTheme ? "hidden" : "visible"} triggerClassName={dockBtn(false)} />
      </ToolbarAction>
      <ToolbarAction name="settings" order={TOOLBAR_OVERFLOW.settings} hidden={hideSettings}>
        <Tooltip label={settingsLabel} side="bottom">
          <Button type="button" variant="ghost" size="icon" className={dockBtn(false)}
            data-testid={hideSettings ? undefined : "open-settings"} aria-label={t(($) => $.shell.dock.settings)}
            aria-describedby={CLOUD_ATTENTION_HINT_ID}
            onClick={() => setSettingsOpen(true)} {...intentProps("settings")}><SettingsIcon className="size-4" /></Button>
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
            <SettingsIcon className="size-4" />{settingsLabel}
          </DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
      </ToolbarAction>
    </div>
  );
}
