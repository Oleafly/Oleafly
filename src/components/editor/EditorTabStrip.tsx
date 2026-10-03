import {
  useMemo,
  useRef,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, X } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { useFilesStore } from "@/store/files";
import { useDiffStore, type DiffSide } from "@/store/diff";
import { basename } from "@/lib/path-utils";
import { cn } from "@/lib/utils";
import { FileTabStatus } from "./FileTabStatus";
import {
  closeAssistantTabs,
  closeEditorTab,
  closeEditorTabsAround,
  editorTabKey,
  editorTabs,
  type CloseScope,
  type EditorTab,
} from "./editor-tabs";

const DIFF_TAB_SIDE_LABEL = {
  working: "diffWorkingTree",
  staged: "diffIndex",
  disk: "diffOnDisk",
} as const satisfies Record<DiffSide, string>;

const MIDDLE_BUTTON = 1;

function openMenuFrom(row: HTMLElement | null) {
  if (!row) return;
  const rect = row.getBoundingClientRect();
  row.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(rect.left + rect.width / 2),
      clientY: Math.round(rect.bottom),
    }),
  );
}

function preventMiddleScroll(event: ReactMouseEvent) {
  if (event.button === MIDDLE_BUTTON) event.preventDefault();
}

interface ScopeItem {
  scope: CloseScope;
  label: string;
  disabled: boolean;
}

function EditorTabMenu({
  tab,
  position,
  total,
}: Readonly<{ tab: EditorTab; position: number; total: number }>) {
  const { t } = useTranslation(["common", "editor"]);
  const assistantCount = useFilesStore((s) => s.assistantTabs.length);
  const items: ScopeItem[] = [
    { scope: "others", label: t(($) => $.editor.shell.closeOthers), disabled: total < 2 },
    { scope: "left", label: t(($) => $.editor.shell.closeLeft), disabled: position === 0 },
    { scope: "right", label: t(($) => $.editor.shell.closeRight), disabled: position >= total - 1 },
    { scope: "all", label: t(($) => $.editor.shell.closeAll), disabled: false },
  ];
  return (
    <ContextMenuContent className="w-60" data-testid="editor-tab-menu">
      <ContextMenuItem data-testid="editor-tab-menu-close" onClick={() => closeEditorTab(tab)}>
        {t(($) => $.common.actions.close)}
      </ContextMenuItem>
      {items.map((item) => (
        <ContextMenuItem
          key={item.scope}
          data-testid={`editor-tab-menu-close-${item.scope}`}
          disabled={item.disabled}
          onClick={() => closeEditorTabsAround(editorTabKey(tab), item.scope)}
        >
          {item.label}
        </ContextMenuItem>
      ))}
      <ContextMenuSeparator />
      <ContextMenuItem
        data-testid="editor-tab-menu-close-assistant"
        disabled={assistantCount === 0}
        onClick={closeAssistantTabs}
      >
        {t(($) => $.editor.shell.closeAssistantTabs)}
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

function EditorTabItem({
  tab,
  position,
  total,
  active,
  closeLabel,
  onActivate,
  children,
}: Readonly<{
  tab: EditorTab;
  position: number;
  total: number;
  active: boolean;
  closeLabel: string;
  onActivate: () => void;
  children: ReactNode;
}>) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const onAuxClick = (event: ReactMouseEvent) => {
    if (event.button !== MIDDLE_BUTTON) return;
    event.preventDefault();
    closeEditorTab(tab);
  };
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      event.preventDefault();
      openMenuFrom(rowRef.current);
    }
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild onMouseDown={preventMiddleScroll} onAuxClick={onAuxClick}>
        <div
          ref={rowRef}
          className={cn(
            "group flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs",
            active
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:bg-accent"
          )}
        >
          <button
            type="button"
            onClick={onActivate}
            onKeyDown={onTabKeyDown}
            className="flex items-center gap-1.5"
          >
            {children}
          </button>
          <button
            type="button"
            aria-label={closeLabel}
            onClick={(e) => {
              e.stopPropagation();
              closeEditorTab(tab);
            }}
            className="ml-0.5 cursor-pointer rounded p-0.5 hover:bg-accent"
          >
            <X className="size-3" />
          </button>
        </div>
      </ContextMenuTrigger>
      <EditorTabMenu tab={tab} position={position} total={total} />
    </ContextMenu>
  );
}

function AssistantTabMark() {
  const { t } = useTranslation(["editor"]);
  const label = t(($) => $.editor.shell.assistantTab);
  return (
    <span title={label} data-testid="editor-tab-assistant-mark" className="inline-flex text-primary">
      <Sparkles aria-hidden="true" className="size-3" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function EditorTabStrip({ diffFocused }: Readonly<{ diffFocused: boolean }>) {
  const { t } = useTranslation(["common", "editor"]);
  const openTabs = useFilesStore((s) => s.openTabs);
  const tabOrder = useFilesStore((s) => s.tabOrder);
  const activePath = useFilesStore((s) => s.activePath);
  const assistantTabs = useFilesStore((s) => s.assistantTabs);
  const setActive = useFilesStore((s) => s.setActive);
  const diffs = useDiffStore((s) => s.diffs);
  const activeKey = useDiffStore((s) => s.activeKey);
  const setActiveDiff = useDiffStore((s) => s.setActiveDiff);
  const tabs = useMemo(() => editorTabs(openTabs, tabOrder, diffs), [openTabs, tabOrder, diffs]);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2 no-scrollbar">
      {tabs.length === 0 && (
        <span className="px-2 text-xs text-muted-foreground">
          {t(($) => $.editor.shell.noFileOpenTab)}
        </span>
      )}
      {tabs.map((tab, position) =>
        tab.kind === "file" ? (
          <EditorTabItem
            key={`f:${tab.id}`}
            tab={tab}
            position={position}
            total={tabs.length}
            active={tab.id === activePath && !diffFocused}
            closeLabel={t(($) => $.editor.shell.closeFile, { name: basename(tab.id) })}
            onActivate={() => setActive(tab.id)}
          >
            {basename(tab.id)}
            {assistantTabs.includes(tab.id) ? <AssistantTabMark /> : null}
            <FileTabStatus path={tab.id} />
          </EditorTabItem>
        ) : (
          <EditorTabItem
            key={`d:${tab.id}`}
            tab={tab}
            position={position}
            total={tabs.length}
            active={activeKey === tab.id}
            closeLabel={t(($) => $.editor.shell.closeDiffTab, { name: basename(tab.d.path) })}
            onActivate={() => setActiveDiff(tab.id)}
          >
            {basename(tab.d.path)}
            <span className="text-muted-foreground">
              {t(($) => $.editor.shell[DIFF_TAB_SIDE_LABEL[tab.d.side]])}
            </span>
          </EditorTabItem>
        )
      )}
    </div>
  );
}

export function CloseAssistantTabsButton() {
  const { t } = useTranslation(["editor"]);
  const count = useFilesStore((s) => s.assistantTabs.length);
  if (count === 0) return null;
  const label = t(($) => $.editor.shell.closeAssistantTabsCount, { count });
  return (
    <Tooltip label={label} side="bottom">
      <button
        type="button"
        aria-label={label}
        data-testid="editor-close-assistant-tabs"
        onClick={closeAssistantTabs}
        className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
      >
        <Sparkles className="size-3.5" aria-hidden />
        <span aria-hidden>{count}</span>
        <X className="size-3" aria-hidden />
      </button>
    </Tooltip>
  );
}
