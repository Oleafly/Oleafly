import { create } from "zustand";
import type { GitWorkspaceSnapshot } from "@oleafly/backend-port";
import type { SearchHit } from "@/lib/tauri";

export const SIDEBAR_VIEW_PROJECT_LIMIT = 32;

export type SidebarScrollSlot =
  | "files"
  | "outline"
  | "structure"
  | "search"
  | "sourceControl"
  | "preflight"
  | "mcp"
  | "references.results"
  | "references.citations"
  | "references.symbols"
  | "research.tasks"
  | "research.folders";

export type SidebarTreeSlot =
  | "structure"
  | "references.results"
  | "references.citations"
  | "references.symbols";

export interface SidebarTreeMemory {
  readonly collapsed: ReadonlySet<string>;
  readonly expanded: ReadonlySet<string>;
  readonly focusedId: string | null;
}

interface SidebarPanelViews {
  files: {
    readonly expanded: ReadonlySet<string>;
    readonly selected: { readonly path: string; readonly isDir: boolean } | null;
  };
  taskOutputs: { readonly open: boolean };
  outline: {
    readonly collapsedHeadings: ReadonlySet<string>;
    readonly evaluatedDocumentKey: string | null;
    readonly autoCollapsedDocumentKey: string | null;
  };
  structure: { readonly filter: string };
  search: {
    readonly query: string;
    readonly term: string;
    readonly hits: readonly SearchHit[];
  };
  sourceControl: {
    readonly snapshot: GitWorkspaceSnapshot | null;
    readonly title: string;
    readonly description: string;
    readonly sectionOpen: {
      readonly staged: boolean;
      readonly changes: boolean;
      readonly graph: boolean;
    };
    readonly branchFormOpen: boolean;
    readonly branchDraft: string;
  };
  references: {
    readonly view: "results" | "citations" | "symbols";
    readonly filter: string;
    readonly handledFocusRequest: number;
  };
  researchWorkspace: { readonly tab: "tasks" | "folders" };
  researchTasks: { readonly filter: "all" | "running" | "review" | "done" };
}

type SidebarScrollViews = {
  [Slot in SidebarScrollSlot as `scroll.${Slot}`]: number;
};

type SidebarTreeViews = {
  [Slot in SidebarTreeSlot as `tree.${Slot}`]: SidebarTreeMemory;
};

export type SidebarViewStates = SidebarPanelViews & SidebarScrollViews & SidebarTreeViews;
export type SidebarViewKey = keyof SidebarViewStates;

type ProjectViews = { [Key in SidebarViewKey]?: SidebarViewStates[Key] };

interface SidebarViewStore {
  projects: ReadonlyMap<string, ProjectViews>;
  write: <Key extends SidebarViewKey>(
    projectId: string,
    key: Key,
    value: SidebarViewStates[Key],
  ) => void;
  reset: () => void;
}

export const useSidebarViewStore = create<SidebarViewStore>((set) => ({
  projects: new Map(),
  write: (projectId, key, value) =>
    set((state) => {
      const projects = new Map(state.projects);
      const current = projects.get(projectId);
      projects.delete(projectId);
      projects.set(projectId, { ...current, [key]: value });
      if (projects.size > SIDEBAR_VIEW_PROJECT_LIMIT) {
        const [oldest] = projects.keys();
        projects.delete(oldest);
      }
      return { projects };
    }),
  reset: () => set({ projects: new Map() }),
}));

export function readSidebarView<Key extends SidebarViewKey>(
  projectId: string | null,
  key: Key,
): SidebarViewStates[Key] | undefined {
  if (!projectId) return undefined;
  return useSidebarViewStore.getState().projects.get(projectId)?.[key];
}

export function writeSidebarView<Key extends SidebarViewKey>(
  projectId: string | null,
  key: Key,
  value: SidebarViewStates[Key],
): void {
  if (projectId) useSidebarViewStore.getState().write(projectId, key, value);
}

export function resetSidebarViewState(): void {
  useSidebarViewStore.getState().reset();
}
