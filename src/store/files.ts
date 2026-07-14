import { create } from "zustand";
import {
  createFile as apiCreateFile,
  copyFile as apiCopyFile,
  createProject as apiCreateProject,
  createProjectFromTemplate as apiCreateFromTemplate,
  deleteFile as apiDeleteFile,
  gitLog,
  gitRestore,
  getProject,
  listFiles,
  listProjects,
  readFileContent,
  renameFile as apiRenameFile,
  renameProjectCmd,
  setMainDocCmd,
  writeFileContent,
  type FileEntry,
  type ProjectInfo,
} from "@/lib/tauri";
import { flushAutoCommit, scheduleAutoCommit } from "@/lib/auto-commit";
import { logError } from "@/lib/log";
import { notifyError } from "@/lib/toast";
import { useDiffStore } from "@/store/diff";
import { nextTabSeq } from "@/store/tab-order";

interface FileState {
  content: string;
  dirty: boolean;
}

interface FilesStore {
  projectId: string | null;
  projectName: string;
  // Project kind: "" for a normal document project, "image" for a single-figure
  // project (hides doc-only tools like Insert diagram).
  projectKind: string;
  mainDoc: string;
  tree: FileEntry[];
  files: Record<string, FileState>;
  openTabs: string[];
  // Open-order stamp per file tab, shared with diff tabs so the editor renders
  // files and diffs interleaved by the order they were opened.
  tabOrder: Record<string, number>;
  activePath: string | null;
  projects: ProjectInfo[];
  projectsLoaded: boolean;
  loading: boolean;
  docVersion: number;

  refreshProjects: () => Promise<void>;
  openProject: (id: string) => Promise<void>;
  closeProject: () => void;
  createProject: (name: string) => Promise<void>;
  renameProject: (name: string) => Promise<void>;
  createFromTemplate: (name: string, templateId: string, color?: string) => Promise<string>;
  restoreFromGit: (oid: string) => Promise<void>;

  refreshTree: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  setActive: (path: string) => void;
  closeTab: (path: string) => void;
  setContent: (path: string, content: string) => void;
  saveActive: () => Promise<void>;
  saveFile: (path: string) => Promise<void>;
  createFile: (path: string, isDir: boolean) => Promise<void>;
  deleteEntry: (path: string) => Promise<void>;
  renameEntry: (from: string, to: string) => Promise<void>;
  copyEntry: (path: string, isDir?: boolean) => Promise<void>;
  applyExternalWrite: (path: string, content: string) => void;
  applyExternalDelete: (path: string) => void;
  applyExternalRename: (from: string, to: string) => void;
  setMainDoc: (path: string) => Promise<void>;
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
// Every path edited since the last flush. The single debounce timer saves the
// whole set, so editing file A then switching to B before the timer fires no
// longer drops A's changes.
const pendingSaves = new Set<string>();
// Bumped on every openProject so an in-flight load from a previous project can
// detect it is stale and stop writing into the newly opened project's state.
let openSeq = 0;

function cancelPendingAutosave() {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
  pendingSaves.clear();
}

export const useFilesStore = create<FilesStore>((set, get) => ({
  projectId: null,
  projectName: "",
  projectKind: "",
  mainDoc: "main.tex",
  tree: [],
  files: {},
  openTabs: [],
  tabOrder: {},
  activePath: null,
  projects: [],
  projectsLoaded: false,
  loading: false,
  docVersion: 0,

  refreshProjects: async () => {
    const projects = await listProjects();
    set({ projects, projectsLoaded: true });
  },

  openProject: async (id) => {
    const seq = ++openSeq;
    // Land any pending auto-commit for the previous project, then drop pending
    // autosaves and every buffer so its dirty tabs can't be written into this
    // project's directory.
    flushAutoCommit();
    cancelPendingAutosave();
    set({
      loading: true,
      projectId: id,
      projectName: "",
      projectKind: "",
      mainDoc: "main.tex",
      tree: [],
      files: {},
      openTabs: [],
      tabOrder: {},
      activePath: null,
    });
    try {
      const meta = await getProject(id);
      if (seq !== openSeq) return; // a newer openProject superseded this one
      const tree = await listFiles(id);
      if (seq !== openSeq) return;
      set({ projectName: meta.name, projectKind: meta.kind ?? "", mainDoc: meta.main_doc, tree });
      // Preload .bib files so citation autocomplete works.
      const bibs = tree.filter((f) => !f.is_dir && f.path.endsWith(".bib"));
      for (const b of bibs) {
        try {
          const content = await readFileContent(id, b.path);
          if (seq !== openSeq) return;
          set((s) => ({
            files: { ...s.files, [b.path]: { content, dirty: false } },
          }));
        } catch {
          /* ignore unreadable bib */
        }
      }
      await get().openFile(meta.main_doc || "main.tex");
    } catch (e) {
      // Surface the failure and fall back to the library rather than leaving the
      // app wedged in a half-open project with an empty tree.
      if (seq === openSeq) {
        set({ projectId: null });
        notifyError("open project", e, "Could not open the project. See the app log for details.");
      }
    } finally {
      if (seq === openSeq) set({ loading: false });
    }
  },

  closeProject: () => {
    flushAutoCommit();
    cancelPendingAutosave();
    set({
      projectId: null,
      projectName: "",
      tree: [],
      files: {},
      openTabs: [],
      tabOrder: {},
      activePath: null,
    });
  },

  createProject: async (name) => {
    const id = await apiCreateProject(name);
    await get().refreshProjects();
    await get().openProject(id);
  },

  renameProject: async (name) => {
    const { projectId } = get();
    if (!projectId) return;
    const meta = await renameProjectCmd(projectId, name);
    set({ projectName: meta.name });
    await get().refreshProjects();
  },

  createFromTemplate: async (name, templateId, color) => {
    const id = await apiCreateFromTemplate(name, templateId, color);
    await get().refreshProjects();
    await get().openProject(id);
    return id;
  },

  refreshTree: async () => {
    const { projectId } = get();
    if (!projectId) return;
    const tree = await listFiles(projectId);
    set({ tree });
  },

  openFile: async (path) => {
    const { projectId, files } = get();
    if (!projectId) return;
    if (path.endsWith("/")) return;
    // Binary files (PDFs/images) aren't readable as text - skip the text load
    // and just open the tab; the editor renders them via a binary viewer.
    const isBinary = /\.(pdf|png|jpe?g|gif|webp|svg|eps|zip|gz|ttf|otf|woff2?)$/i.test(path);
    if (!files[path] && !isBinary) {
      try {
        const content = await readFileContent(projectId, path);
        set((s) => ({
          files: { ...s.files, [path]: { content, dirty: false } },
        }));
      } catch {
        return;
      }
    }
    // Opening a file makes it the active view, so unfocus any git diff (otherwise
    // the diff keeps the editor and the newly opened file never becomes active).
    useDiffStore.getState().clearActiveDiff();
    set((s) => {
      const isNew = !s.openTabs.includes(path);
      return {
        openTabs: isNew ? [...s.openTabs, path] : s.openTabs,
        tabOrder: isNew ? { ...s.tabOrder, [path]: nextTabSeq() } : s.tabOrder,
        activePath: path,
      };
    });
  },

  setActive: (path) => {
    useDiffStore.getState().clearActiveDiff();
    set({ activePath: path });
  },

  closeTab: (path) => {
    const { openTabs, activePath, tabOrder } = get();
    const next = openTabs.filter((p) => p !== path);
    const nextOrder = { ...tabOrder };
    delete nextOrder[path];
    set({
      openTabs: next,
      tabOrder: nextOrder,
      activePath: activePath === path ? (next[next.length - 1] ?? null) : activePath,
    });
  },

  setContent: (path, content) => {
    set((s) => ({
      files: { ...s.files, [path]: { content, dirty: true } },
    }));
    // Debounce a save of THIS file. Track every edited path so the single timer
    // flushes them all, instead of only whichever tab happens to be active when
    // it fires (which silently lost edits to background tabs).
    pendingSaves.add(path);
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null;
      const paths = [...pendingSaves];
      pendingSaves.clear();
      for (const p of paths) {
        get().saveFile(p).catch((e) => notifyError("autosave", e));
      }
    }, 1500);
  },

  saveActive: async () => {
    const { projectId, activePath } = get();
    if (!projectId || !activePath) return;
    await get().saveFile(activePath);
  },

  saveFile: async (path) => {
    const { projectId, files } = get();
    const state = files[path];
    if (!projectId || !state) return;
    const written = state.content;
    await writeFileContent(projectId, path, written);
    set((s) => {
      const cur = s.files[path];
      // The file was deleted while the write was in flight: do not resurrect it
      // as an entry with undefined content.
      if (!cur) return {};
      // Newer keystrokes landed during the write, so what is on disk is already
      // stale. Leave it dirty; a later autosave will persist the newer content.
      if (cur.content !== written) return {};
      return { files: { ...s.files, [path]: { ...cur, dirty: false } } };
    });
    scheduleAutoCommit(projectId);
  },

  createFile: async (path, isDir) => {
    const { projectId } = get();
    if (!projectId) return;
    await apiCreateFile(projectId, path, isDir);
    await get().refreshTree();
    if (!isDir) await get().openFile(path);
  },

  deleteEntry: async (path) => {
    const { projectId } = get();
    if (!projectId) return;
    await apiDeleteFile(projectId, path);
    set((s) => {
      const files = { ...s.files };
      delete files[path];
      return {
        files,
        openTabs: s.openTabs.filter((p) => p !== path && !p.startsWith(path + "/")),
        activePath:
          s.activePath === path || s.activePath?.startsWith(path + "/")
            ? null
            : s.activePath,
      };
    });
    await get().refreshTree();
  },

  renameEntry: async (from, to) => {
    const { projectId } = get();
    if (!projectId) return;
    await apiRenameFile(projectId, from, to);
    // Follow the moved/renamed path in memory so an open tab, its buffer, the
    // active file, and the main-doc pointer don't go stale (also handles folder
    // moves, which carry every descendant path with them).
    const remap = (p: string) =>
      p === from ? to : p.startsWith(`${from}/`) ? `${to}${p.slice(from.length)}` : p;
    set((s) => {
      const files: Record<string, FileState> = {};
      for (const [k, v] of Object.entries(s.files)) files[remap(k)] = v;
      const tabOrder: Record<string, number> = {};
      for (const [k, v] of Object.entries(s.tabOrder)) tabOrder[remap(k)] = v;
      return {
        files,
        openTabs: s.openTabs.map(remap),
        tabOrder,
        activePath: s.activePath ? remap(s.activePath) : null,
        mainDoc: remap(s.mainDoc),
      };
    });
    await get().refreshTree();
  },

  copyEntry: async (path, isDir = false) => {
    const { projectId } = get();
    if (!projectId) return;
    const slash = path.lastIndexOf("/");
    const dir = slash >= 0 ? path.slice(0, slash) : "";
    const file = slash >= 0 ? path.slice(slash + 1) : path;
    // Only split off an extension for files; a folder name is copied whole (so
    // "v1.0" doesn't become "v1 copy.0").
    const dot = isDir ? -1 : file.lastIndexOf(".");
    const base = dot > 0 ? file.slice(0, dot) : file;
    const ext = dot > 0 ? file.slice(dot) : "";
    const to = dir ? `${dir}/${base} copy${ext}` : `${base} copy${ext}`;
    try {
      await apiCopyFile(projectId, path, to);
      await get().refreshTree();
    } catch (e) {
      void logError("copy file", e);
    }
  },

  // Called after an external actor (e.g. the AI assistant) mutates a file on
  // disk, so the in-memory editor buffer stays in sync and the next save does
  // not clobber the edit. Cross-window broadcast is done by the AI host so
  // listeners can re-apply without echoing forever.
  applyExternalWrite: (path, content) => {
    set((s) => ({
      files: { ...s.files, [path]: { content, dirty: false } },
      docVersion: s.activePath === path ? s.docVersion + 1 : s.docVersion,
    }));
    void get().refreshTree();
  },

  applyExternalDelete: (path) => {
    set((s) => {
      const files = { ...s.files };
      delete files[path];
      return {
        files,
        openTabs: s.openTabs.filter((p) => p !== path && !p.startsWith(path + "/")),
        activePath:
          s.activePath === path || s.activePath?.startsWith(path + "/")
            ? null
            : s.activePath,
      };
    });
    void get().refreshTree();
  },

  applyExternalRename: (from, to) => {
    set((s) => {
      const files = { ...s.files };
      if (files[from]) {
        files[to] = { ...files[from] };
        delete files[from];
      }
      const remap = (p: string) =>
        p === from ? to : p.startsWith(`${from}/`) ? `${to}${p.slice(from.length)}` : p;
      const tabOrder: Record<string, number> = {};
      for (const [k, v] of Object.entries(s.tabOrder)) tabOrder[remap(k)] = v;
      return {
        files,
        tabOrder,
        openTabs: s.openTabs.map(remap),
        activePath:
          s.activePath === from
            ? to
            : s.activePath?.startsWith(from + "/")
            ? to + s.activePath!.slice(from.length)
            : s.activePath,
        docVersion: s.activePath === from || s.activePath?.startsWith(from + "/") ? s.docVersion + 1 : s.docVersion,
      };
    });
    void get().refreshTree();
  },

  setMainDoc: async (path) => {
    const { projectId } = get();
    if (!projectId) return;
    const meta = await setMainDocCmd(projectId, path);
    set({ mainDoc: meta.main_doc });
  },

  restoreFromGit: async (oid) => {
    const { projectId } = get();
    if (!projectId) return;
    await gitRestore(projectId, oid);
    // The working tree now holds the restored revision, so every in-memory text
    // buffer is stale. Reload them all (not just the active tab) so a background
    // dirty tab's next autosave can't clobber the restore. Drop buffers whose
    // file no longer exists at this revision.
    cancelPendingAutosave();
    await get().refreshTree();
    const paths = Object.keys(get().files);
    const reloaded: Record<string, FileState> = {};
    for (const p of paths) {
      try {
        reloaded[p] = { content: await readFileContent(projectId, p), dirty: false };
      } catch {
        /* file gone at this revision: drop the stale buffer */
      }
    }
    set((s) => ({
      files: reloaded,
      docVersion: s.docVersion + 1,
      openTabs: s.openTabs.filter((t) => reloaded[t] !== undefined || !paths.includes(t)),
      activePath:
        s.activePath && paths.includes(s.activePath) && reloaded[s.activePath] === undefined
          ? null
          : s.activePath,
    }));
  },
}));

export function useActiveContent(): string {
  return useFilesStore((s) =>
    s.activePath ? s.files[s.activePath]?.content ?? "" : ""
  );
}

// Flush the debounced autosave immediately when the page is going away, so an
// edit made within the debounce window of a reload or quit is not lost.
function flushPendingSaves() {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
  const paths = [...pendingSaves];
  pendingSaves.clear();
  for (const p of paths) {
    useFilesStore
      .getState()
      .saveFile(p)
      .catch((e) => notifyError("autosave", e));
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushPendingSaves);
  window.addEventListener("beforeunload", flushPendingSaves);

  // E2E / devtools hook: read-only commit count, so a test can wait for a
  // fire-and-forget auto-commit to land without opening the History modal.
  (window as unknown as { __gitCommitCount?: () => Promise<number> }).__gitCommitCount =
    async () => {
      const id = useFilesStore.getState().projectId;
      if (!id) return 0;
      try {
        return (await gitLog(id)).length;
      } catch {
        return 0;
      }
    };
}
