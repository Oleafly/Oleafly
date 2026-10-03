import { diffKey, useDiffStore, type OpenDiff } from "@/store/diff";
import { useFilesStore } from "@/store/files";

export type EditorTab =
  | { kind: "file"; id: string; order: number }
  | { kind: "diff"; id: string; d: OpenDiff; order: number };

export type CloseScope = "others" | "left" | "right" | "all";

const IN_SCOPE: Record<CloseScope, (position: number, anchor: number) => boolean> = {
  others: (position, anchor) => position !== anchor,
  left: (position, anchor) => position < anchor,
  right: (position, anchor) => position > anchor,
  all: () => true,
};

export function editorTabs(
  openTabs: readonly string[],
  tabOrder: Readonly<Record<string, number>>,
  diffs: readonly OpenDiff[],
): EditorTab[] {
  const fileTabs: EditorTab[] = openTabs.map((path) => ({
    kind: "file",
    id: path,
    order: tabOrder[path] ?? 0,
  }));
  const diffTabs: EditorTab[] = diffs.map((d) => ({
    kind: "diff",
    id: diffKey(d),
    d,
    order: d.order,
  }));
  return [...fileTabs, ...diffTabs].sort((a, b) => a.order - b.order);
}

export function editorTabKey(tab: Pick<EditorTab, "kind" | "id">): string {
  return `${tab.kind === "file" ? "f" : "d"}:${tab.id}`;
}

export function tabsToClose(
  tabs: readonly EditorTab[],
  anchorKey: string,
  scope: CloseScope,
): EditorTab[] {
  const anchor = tabs.findIndex((tab) => editorTabKey(tab) === anchorKey);
  if (anchor < 0) return [];
  const inScope = IN_SCOPE[scope];
  return tabs.filter((_, position) => inScope(position, anchor));
}

export function currentEditorTabs(): EditorTab[] {
  const { openTabs = [], tabOrder = {} } = useFilesStore.getState();
  const { diffs = [] } = useDiffStore.getState();
  return editorTabs(openTabs, tabOrder, diffs);
}

export function closeEditorTab(tab: EditorTab): void {
  if (tab.kind === "file") useFilesStore.getState().closeTab(tab.id);
  else useDiffStore.getState().closeDiff(tab.id);
}

export function closeEditorTabs(tabs: readonly EditorTab[]): void {
  const paths = tabs.flatMap((tab) => (tab.kind === "file" ? [tab.id] : []));
  const keys = tabs.flatMap((tab) => (tab.kind === "diff" ? [tab.id] : []));
  if (keys.length > 0) useDiffStore.getState().closeDiffs(keys);
  if (paths.length > 0) useFilesStore.getState().closeTabs(paths);
}

function isVisibleTab(tab: EditorTab): boolean {
  const { activeKey, diffs } = useDiffStore.getState();
  const diffFocused = activeKey !== null && diffs.some((d) => diffKey(d) === activeKey);
  if (diffFocused) return tab.kind === "diff" && tab.id === activeKey;
  return tab.kind === "file" && tab.id === useFilesStore.getState().activePath;
}

function focusEditorTab(tab: EditorTab): void {
  if (tab.kind === "file") useFilesStore.getState().setActive(tab.id);
  else useDiffStore.getState().setActiveDiff(tab.id);
}

export function closeEditorTabsAround(anchorKey: string, scope: CloseScope): void {
  const tabs = currentEditorTabs();
  const anchor = tabs.find((tab) => editorTabKey(tab) === anchorKey);
  if (!anchor) return;
  const closing = tabsToClose(tabs, anchorKey, scope);
  const refocus = !closing.includes(anchor) && closing.some(isVisibleTab);
  closeEditorTabs(closing);
  if (refocus) focusEditorTab(anchor);
}

export function closeAllEditorTabs(): void {
  closeEditorTabs(currentEditorTabs());
}

export function openAssistantTabs(): string[] {
  const { openTabs = [], assistantTabs = [] } = useFilesStore.getState();
  return assistantTabs.filter((path) => openTabs.includes(path));
}

export function closeAssistantTabs(): void {
  useFilesStore.getState().closeTabs(openAssistantTabs());
}
