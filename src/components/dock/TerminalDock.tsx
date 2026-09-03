import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Pencil, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { useSettingsStore } from "@/store/settings";
import {
  TERMINAL_LIMIT,
  TERMINAL_LIMIT_MESSAGE,
  TERMINAL_TITLE_MAX_LENGTH,
  useTerminalsStore,
  type TerminalTab,
} from "@/store/terminals";
import { TerminalPane } from "./TerminalPane";

let mountedDocks = 0;

function TerminalTabItem({
  tab,
  active,
  onActivate,
  onClose,
  onRename,
}: {
  tab: TerminalTab;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
  onRename: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tab.title);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [editing]);

  const startEditing = () => {
    settledRef.current = false;
    setDraft(tab.title);
    setEditing(true);
  };
  const commit = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    setEditing(false);
    onRename(draft);
  };
  const cancel = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    setEditing(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  };
  const controlBase =
    "inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-opacity hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
  const hoverOnly = "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100";
  const renameClass = cn(controlBase, hoverOnly);
  const closeClass = cn(controlBase, active ? "opacity-100" : hoverOnly);

  return (
    <div
      role="presentation"
      className={cn(
        "group flex h-6 shrink-0 items-center gap-0.5 rounded-md pl-2 pr-0.5 text-xs transition-colors",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      {editing ? (
        <Input
          ref={inputRef}
          aria-label="Terminal title"
          value={draft}
          maxLength={TERMINAL_TITLE_MAX_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commit}
          className="h-5 w-32 rounded px-1 py-0 text-xs"
        />
      ) : (
        <button
          type="button"
          role="tab"
          aria-selected={active}
          data-testid="dock-terminal-tab"
          data-active={active ? "true" : "false"}
          data-session-index={tab.index}
          onClick={onActivate}
          onDoubleClick={startEditing}
          className="max-w-40 truncate focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm"
        >
          {tab.title}
        </button>
      )}
      <Tooltip label="Rename" side="bottom">
        <button
          type="button"
          aria-label={`Rename ${tab.title}`}
          onClick={startEditing}
          className={renameClass}
        >
          <Pencil className="size-3" aria-hidden />
        </button>
      </Tooltip>
      <Tooltip label="Close" side="bottom">
        <button
          type="button"
          aria-label={`Close ${tab.title}`}
          onClick={onClose}
          className={closeClass}
        >
          <X className="size-3" aria-hidden />
        </button>
      </Tooltip>
    </div>
  );
}

export function TerminalDock({
  projectId,
  projectName,
  visible = true,
}: {
  projectId: string;
  projectName?: string;
  visible?: boolean;
}) {
  const storeProjectId = useTerminalsStore((state) => state.projectId);
  const tabs = useTerminalsStore((state) => state.tabs);
  const activeId = useTerminalsStore((state) => state.activeId);
  const setTerminalOpen = useSettingsStore((state) => state.setTerminalOpen);
  const terminalBackground = useSettingsStore((state) => state.terminalBackground);
  const ready = storeProjectId === projectId;
  const empty = tabs.length === 0;
  const atLimit = tabs.length >= TERMINAL_LIMIT;

  useLayoutEffect(() => {
    mountedDocks += 1;
    useTerminalsStore.getState().setProject(projectId);
    return () => {
      mountedDocks -= 1;
      queueMicrotask(() => {
        if (mountedDocks === 0) useTerminalsStore.getState().setProject(null);
      });
    };
  }, [projectId]);

  useEffect(() => {
    if (!visible || !ready || !empty) return;
    const state = useTerminalsStore.getState();
    if (state.projectId === projectId && state.tabs.length === 0) state.addTerminal();
  }, [empty, projectId, ready, visible]);

  const closeTab = (id: string) => {
    const state = useTerminalsStore.getState();
    if (!state.tabs.some((tab) => tab.id !== id)) setTerminalOpen(false);
    state.closeTerminal(id);
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div
        role="tablist"
        aria-label="Terminals"
        data-testid="dock-terminal-tabs"
        className="flex h-8 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border bg-background px-1"
      >
        {ready &&
          tabs.map((tab) => (
            <TerminalTabItem
              key={tab.id}
              tab={tab}
              active={tab.id === activeId}
              onActivate={() => useTerminalsStore.getState().activateTerminal(tab.id)}
              onClose={() => closeTab(tab.id)}
              onRename={(title) => useTerminalsStore.getState().renameTerminal(tab.id, title)}
            />
          ))}
        <Tooltip label={atLimit ? TERMINAL_LIMIT_MESSAGE : "New terminal"} side="bottom">
          <button
            type="button"
            aria-label="New terminal"
            disabled={atLimit || !ready}
            onClick={() => useTerminalsStore.getState().addTerminal()}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            <Plus className="size-4" aria-hidden />
          </button>
        </Tooltip>
      </div>
      <div
        className="flex min-h-0 flex-1 flex-col"
        style={{ backgroundColor: terminalBackground }}
      >
        {ready &&
          tabs.map((tab) => (
            <TerminalPane
              key={tab.id}
              projectId={projectId}
              projectName={projectName}
              visible={visible && tab.id === activeId}
              active={tab.id === activeId}
              autoStart={tab.autoStart}
              onExit={() => closeTab(tab.id)}
            />
          ))}
      </div>
    </div>
  );
}
