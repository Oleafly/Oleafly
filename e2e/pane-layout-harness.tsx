import { useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { mockWindows } from "@tauri-apps/api/mocks";
import { prepareHarnessI18n } from "./harness-i18n";
import "/src/styles/globals.css";

mockWindows("main");
await prepareHarnessI18n();

const [{ useKeptAliveHost }, { PaneReorderProvider, usePaneBar, PANE_BAR_CLASS }, { PaneTreeGroup, PaneTreeProvider }, panes, saved, settings, files, { useSeparatorHitArea }] =
  await Promise.all([
    import("/src/components/layout/KeptAliveSlot"),
    import("/src/components/layout/pane-reorder"),
    import("/src/components/layout/PaneTree"),
    import("/src/store/pane-layout"),
    import("/src/store/saved-layouts"),
    import("/src/store/settings"),
    import("/src/store/files"),
    import("/src/lib/panel-layout"),
  ]);

const PANES = ["sidebar", "editor", "pdf", "terminal", "assistant"] as const;
type Pane = (typeof PANES)[number];

settings.useSettingsStore.setState({
  viewMode: "split",
  showTree: true,
  assistantOpen: true,
  workspaceHidden: false,
  terminalOpen: false,
});
files.useFilesStore.setState({ projectId: "p1" });

function Stub({ pane }: Readonly<{ pane: Pane }>) {
  const bar = usePaneBar();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div {...bar} data-testid={`${pane}-bar`} className={`h-8 shrink-0 border-b px-2 text-xs ${PANE_BAR_CLASS}`}>
        {pane}
      </div>
      <div data-testid={`${pane}-body`} className="min-h-0 flex-1 p-2 text-xs">
        {pane}
      </div>
    </div>
  );
}

function Harness() {
  const layout = panes.usePaneLayoutStore((state) => state.layout);
  const epoch = panes.usePaneLayoutStore((state) => state.epoch);
  const viewMode = settings.useSettingsStore((state) => state.viewMode);
  const showTree = settings.useSettingsStore((state) => state.showTree);
  const assistantOpen = settings.useSettingsStore((state) => state.assistantOpen);
  const workspaceHidden = settings.useSettingsStore((state) => state.workspaceHidden);
  const terminalOpen = settings.useSettingsStore((state) => state.terminalOpen);
  const rootRef = useRef<HTMLDivElement>(null);
  const separatorHitArea = useSeparatorHitArea(0.375);
  const hosts = {
    sidebar: useKeptAliveHost("h-full min-h-0 min-w-0"),
    editor: useKeptAliveHost("h-full min-h-0 min-w-0"),
    pdf: useKeptAliveHost("h-full min-h-0 min-w-0"),
    terminal: useKeptAliveHost("h-full min-h-0 min-w-0"),
    assistant: useKeptAliveHost("h-full min-h-0 min-w-0"),
  };
  const shown = useMemo(
    () => panes.paneVisibility({ viewMode, showTree, assistantOpen, workspaceHidden, terminalOpen }),
    [assistantOpen, showTree, terminalOpen, viewMode, workspaceHidden],
  );
  const config = useMemo(
    () => ({
      projectId: "p1",
      shown,
      workspaceHidden,
      appFontSize: 16,
      hosts,
      separatorHitArea,
      rootRef,
      onAssistantDismiss: () => settings.useSettingsStore.setState({ assistantOpen: false }),
      onTerminalDismiss: () => settings.useSettingsStore.setState({ terminalOpen: false }),
    }),
    [hosts.assistant, hosts.editor, hosts.pdf, hosts.sidebar, hosts.terminal, separatorHitArea, shown, workspaceHidden],
  );
  const visible = PANES.filter((pane) => shown[pane]);
  return (
    <PaneReorderProvider rootRef={rootRef} visiblePanes={visible}>
      <div className="flex h-screen w-screen">
        <PaneTreeProvider value={config}>
          <PaneTreeGroup key={`p1:${epoch}:${layout.id}`} node={layout} root />
        </PaneTreeProvider>
      </div>
      {PANES.map((pane) => createPortal(<Stub pane={pane} />, hosts[pane], pane))}
    </PaneReorderProvider>
  );
}

Object.assign(window, {
  __layout: {
    panes: panes.usePaneLayoutStore,
    settings: settings.useSettingsStore,
    saved: saved.useSavedLayoutsStore,
    layoutKey: panes.layoutKey,
  },
});

const root = document.getElementById("root");
if (!root) throw new Error("Pane layout fixture root is missing");
createRoot(root).render(<Harness />);
document.body.dataset.fixtureState = "mounted";
