import { memo, Suspense, useEffect, useMemo, useRef, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { lazy } from "@/lib/preloadable";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { NotebookPen, Sparkles, X } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { useStripReorder, type StripItemProps } from "@/components/layout/strip-reorder";
import { useFilesStore } from "@/store/files";
import { useDiffStore, type DiffSide, type OpenDiff } from "@/store/diff";
import { activeNoteTab, editsAsMarkdown, noteTabsFor, useNoteTabsStore } from "@/store/note-tabs";
import { useSettingsStore } from "@/store/settings";
import { isMarkdownFile, noteFileFacts, noteFileStem } from "@/lib/project-notes";
import { openContextMenuFromKey } from "@/lib/context-menu-key";
import { logError } from "@/lib/log";
import { basename } from "@/lib/path-utils";
import { cn } from "@/lib/utils";
import { FileTabStatus } from "./FileTabStatus";
import {
  closeAssistantTabs,
  closeEditorTab,
  closeEditorTabsAround,
  editorTabKey,
  editorTabs,
  reorderEditorTabs,
  type CloseScope,
  type EditorTab,
} from "./editor-tabs";

const DIFF_TAB_SIDE_LABEL = {
  working: "diffWorkingTree",
  staged: "diffIndex",
  disk: "diffOnDisk",
} as const satisfies Record<DiffSide, string>;

const MIDDLE_BUTTON = 1;

const NoteTabIcon = lazy(() => import("@/components/notes/note-tab-icon"), { warm: () => useSettingsStore.getState().notes });

const loadNoteTabMenu = () => import("./note-tab-menu");
const NoteTabMenuItems = lazy(loadNoteTabMenu, { warm: () => useSettingsStore.getState().notes });

function useNoteTabMenu(tab: EditorTab): boolean {
  const notesOn = useSettingsStore((s) => s.notes);
  return useFilesStore(
    (s) =>
      tab.kind === "note" ||
      (tab.kind === "file" &&
        notesOn &&
        s.projectKind !== "note" &&
        isMarkdownFile(tab.id) &&
        noteFileFacts(s.files[tab.id]?.content) !== null),
  );
}

interface NoteLabel {
  title: string;
  icon?: string;
  color?: string;
}

function useNoteFileLabel(path: string): NoteLabel | null {
  const notesOn = useSettingsStore((s) => s.notes);
  const projectId = useFilesStore((s) => s.projectId);
  const markdown = useNoteTabsStore((s) => editsAsMarkdown(s, projectId, path));
  const facts = useFilesStore(
    useShallow((s) => {
      if (!notesOn || markdown || s.projectKind === "note" || !isMarkdownFile(path)) return null;
      const found = noteFileFacts(s.files[path]?.content);
      return found ? { title: found.title, icon: found.icon, color: found.color } : null;
    }),
  );
  return useMemo(
    () =>
      facts
        ? { title: facts.title ?? noteFileStem(path), icon: facts.icon ?? undefined, color: facts.color ?? undefined }
        : null,
    [facts, path],
  );
}

function NoteTabMark({ icon, color }: Readonly<{ icon?: string; color?: string }>) {
  useEffect(() => {
    loadNoteTabMenu().catch((error: unknown) => logError("load the note tab menu", error));
  }, []);
  return (
    <Suspense fallback={<NotebookPen aria-hidden className="size-3.5 shrink-0" />}>
      <NoteTabIcon icon={icon} color={color} />
    </Suspense>
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

function useEditorTabPlacement(tab: EditorTab): { position: number; total: number } {
  const openTabs = useFilesStore((s) => s.openTabs);
  const tabOrder = useFilesStore((s) => s.tabOrder);
  const projectId = useFilesStore((s) => s.projectId);
  const diffs = useDiffStore((s) => s.diffs);
  const allNotes = useNoteTabsStore((s) => s.tabs);
  return useMemo(() => {
    const tabs = editorTabs(openTabs, tabOrder, diffs, noteTabsFor({ tabs: allNotes }, projectId));
    const key = editorTabKey(tab);
    return { position: tabs.findIndex((entry) => editorTabKey(entry) === key), total: tabs.length };
  }, [allNotes, diffs, openTabs, projectId, tab, tabOrder]);
}

function EditorTabMenu({ tab }: Readonly<{ tab: EditorTab }>) {
  return (
    <ContextMenuContent className="w-60" data-testid="editor-tab-menu">
      <EditorTabMenuItems tab={tab} />
    </ContextMenuContent>
  );
}

function EditorTabMenuItems({ tab }: Readonly<{ tab: EditorTab }>) {
  const { t } = useTranslation(["common", "editor"]);
  const assistantCount = useFilesStore((s) => s.assistantTabs.length);
  const { position, total } = useEditorTabPlacement(tab);
  const noteMenu = useNoteTabMenu(tab);
  const items: ScopeItem[] = [
    { scope: "others", label: t(($) => $.editor.shell.closeOthers), disabled: total < 2 },
    { scope: "left", label: t(($) => $.editor.shell.closeLeft), disabled: position === 0 },
    { scope: "right", label: t(($) => $.editor.shell.closeRight), disabled: position >= total - 1 },
    { scope: "all", label: t(($) => $.editor.shell.closeAll), disabled: false },
  ];
  return (
    <>
      {noteMenu ? (
        <Suspense fallback={null}>
          <NoteTabMenuItems tab={tab} />
        </Suspense>
      ) : null}
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
    </>
  );
}

interface TabDrag {
  reorderItem: (key: string) => StripItemProps;
  dragging: boolean;
}

function EditorTabItem({
  tab,
  active,
  dragging,
  reorderItem,
  closeLabel,
  onActivate,
  children,
}: Readonly<TabDrag & {
  tab: EditorTab;
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
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => openContextMenuFromKey(event, rowRef.current);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild onMouseDown={preventMiddleScroll} onAuxClick={onAuxClick}>
        <div
          ref={rowRef}
          {...reorderItem(editorTabKey(tab))}
          className={cn(
            "group flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs",
            active || dragging
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
      <EditorTabMenu tab={tab} />
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

const FileTab = memo(function FileTab({
  path,
  order,
  active,
  assistant,
  closeLabel,
  ...drag
}: Readonly<TabDrag & {
  path: string;
  order: number;
  active: boolean;
  assistant: boolean;
  closeLabel: string;
}>) {
  const tab = useMemo<EditorTab>(() => ({ kind: "file", id: path, order }), [path, order]);
  const note = useNoteFileLabel(path);
  return (
    <EditorTabItem
      {...drag}
      tab={tab}
      active={active}
      closeLabel={closeLabel}
      onActivate={() => useFilesStore.getState().setActive(path)}
    >
      {note ? (
        <>
          <NoteTabMark icon={note.icon} color={note.color} />
          <span data-testid="editor-note-tab-title" className="max-w-48 truncate">
            {note.title}
          </span>
        </>
      ) : (
        basename(path)
      )}
      {assistant ? <AssistantTabMark /> : null}
      <FileTabStatus path={path} />
    </EditorTabItem>
  );
});

const DiffTab = memo(function DiffTab({
  id,
  diff,
  active,
  closeLabel,
  sideLabel,
  ...drag
}: Readonly<TabDrag & {
  id: string;
  diff: OpenDiff;
  active: boolean;
  closeLabel: string;
  sideLabel: string;
}>) {
  const tab = useMemo<EditorTab>(
    () => ({ kind: "diff", id, d: diff, order: diff.order }),
    [id, diff],
  );
  return (
    <EditorTabItem
      {...drag}
      tab={tab}
      active={active}
      closeLabel={closeLabel}
      onActivate={() => useDiffStore.getState().setActiveDiff(id)}
    >
      {basename(diff.path)}
      <span className="text-muted-foreground">{sideLabel}</span>
    </EditorTabItem>
  );
});

const PersonalNoteTab = memo(function PersonalNoteTab({
  id,
  order,
  active,
  ...drag
}: Readonly<TabDrag & {
  id: string;
  order: number;
  active: boolean;
}>) {
  const { t } = useTranslation(["common", "editor"]);
  const tab = useMemo<EditorTab>(() => ({ kind: "note", id, order }), [id, order]);
  const title = useFilesStore((s) => s.projects.find((project) => project.id === id)?.name ?? "");
  const look = useNoteTabsStore(
    useShallow((s) => {
      const found = s.tabs.find((entry) => entry.id === id);
      return { icon: found?.icon, color: found?.color };
    }),
  );
  return (
    <EditorTabItem
      {...drag}
      tab={tab}
      active={active}
      closeLabel={t(($) => $.editor.shell.closeFile, { name: title })}
      onActivate={() => useNoteTabsStore.getState().setActive(id)}
    >
      <NoteTabMark icon={look.icon} color={look.color} />
      <span data-testid="editor-personal-note-tab-title" className="max-w-48 truncate">
        {title}
      </span>
    </EditorTabItem>
  );
});

export function EditorTabStrip({ diffFocused }: Readonly<{ diffFocused: boolean }>) {
  const { t } = useTranslation(["common", "editor"]);
  const openTabs = useFilesStore((s) => s.openTabs);
  const tabOrder = useFilesStore((s) => s.tabOrder);
  const activePath = useFilesStore((s) => s.activePath);
  const assistantTabs = useFilesStore((s) => s.assistantTabs);
  const projectId = useFilesStore((s) => s.projectId);
  const diffs = useDiffStore((s) => s.diffs);
  const activeKey = useDiffStore((s) => s.activeKey);
  const notesOn = useSettingsStore((s) => s.notes);
  const allNotes = useNoteTabsStore((s) => s.tabs);
  const activeNote = useNoteTabsStore((s) => (notesOn ? activeNoteTab(s, projectId) : null));
  const notes = useMemo(
    () => (notesOn ? noteTabsFor({ tabs: allNotes }, projectId) : []),
    [allNotes, notesOn, projectId],
  );
  const tabs = useMemo(() => editorTabs(openTabs, tabOrder, diffs, notes), [openTabs, tabOrder, diffs, notes]);
  const fileFocused = !diffFocused && activeNote === null;
  const keys = useMemo(() => tabs.map(editorTabKey), [tabs]);
  const reorder = useStripReorder(keys, reorderEditorTabs);
  const drag = (tab: EditorTab): TabDrag => ({ reorderItem: reorder.item, dragging: reorder.dragging === editorTabKey(tab) });
  const renderTab = (tab: EditorTab) => {
    if (tab.kind === "file") {
      return (
        <FileTab
          {...drag(tab)}
          key={`f:${tab.id}`}
          path={tab.id}
          order={tab.order}
          active={tab.id === activePath && fileFocused}
          assistant={assistantTabs.includes(tab.id)}
          closeLabel={t(($) => $.editor.shell.closeFile, { name: basename(tab.id) })}
        />
      );
    }
    if (tab.kind === "note") {
      return <PersonalNoteTab {...drag(tab)} key={`n:${tab.id}`} id={tab.id} order={tab.order} active={activeNote === tab.id} />;
    }
    return (
      <DiffTab
        {...drag(tab)}
        key={`d:${tab.id}`}
        id={tab.id}
        diff={tab.d}
        active={activeKey === tab.id && activeNote === null}
        closeLabel={t(($) => $.editor.shell.closeDiffTab, { name: basename(tab.d.path) })}
        sideLabel={t(($) => $.editor.shell[DIFF_TAB_SIDE_LABEL[tab.d.side]])}
      />
    );
  };

  return (
    <div {...reorder.strip} className="relative flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2 no-scrollbar">
      {tabs.length === 0 && (
        <span className="px-2 text-xs text-muted-foreground">
          {t(($) => $.editor.shell.noFileOpenTab)}
        </span>
      )}
      {tabs.map((tab) => renderTab(tab))}
      {reorder.indicator}
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
