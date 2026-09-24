import { Trans, useTranslation } from "react-i18next";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  ChevronRight,
  CopyMinus,
  CopyPlus,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderClosed,
  Import,
  MoreHorizontal,
  Pencil,
  Star,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useInitialFocus } from "@/components/ui/use-initial-focus";
import { useModalAccessibility } from "@/components/ui/use-modal-accessibility";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useFilesStore } from "@/store/files";
import { SidebarSection } from "@/components/layout/SidebarSection";
import { fileTreePathIsHidden, useSettingsStore } from "@/store/settings";
import { FileIcon } from "@/components/files/fileIcon";
import { LinkedFoldersSection } from "@/components/research/LinkedFoldersSection";
import { TaskOutputsSection } from "@/components/research/TaskOutputsSection";
import { isFileConflictError } from "@/lib/tauri";
import { notifyError, toast } from "@/lib/toast";
import { i18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { pickOpenPath } from "@/lib/native-file-dialog";

async function pickImportSources(mode: "file" | "dir"): Promise<string[]> {
  const picked = await pickOpenPath(
    mode === "dir" ? { directory: true } : { multiple: true },
  );
  if (!picked) return [];
  return Array.isArray(picked) ? picked : [picked];
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
}

type NewEntryMode = null | "file" | "dir";

interface NewEntryDraft {
  mode: NewEntryMode;
  parent: string;
  value: string;
}

type NewEntryFinalizeReason = "blur" | "enter";

function directoryPaths(nodes: readonly TreeNode[]): Set<string> {
  const paths = new Set<string>();
  const pending = [...nodes];
  while (pending.length) {
    const node = pending.pop();
    if (!node) continue;
    if (node.isDir) paths.add(node.path);
    pending.push(...node.children);
  }
  return paths;
}

function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}

function remapTreePath(path: string, from: string, to: string): string {
  if (path === from) return to;
  return path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path;
}

const ROOT = "__root__";
const EMPTY_EXTENSIONS: string[] = [];

function buildTree(paths: { path: string; is_dir: boolean }[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", isDir: true, children: [] };
  for (const { path, is_dir } of paths) {
    const parts = path.split("/").filter(Boolean);
    let node = root;
    parts.forEach((part, i) => {
      const isLast = i === parts.length - 1;
      const childPath = parts.slice(0, i + 1).join("/");
      let child = node.children.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          path: childPath,
          isDir: isLast ? is_dir : true,
          children: [],
        };
        node.children.push(child);
      }
      node = child;
    });
  }
  const sortRec = (n: TreeNode) => {
    n.children.sort((a, b) => {
      if (a.isDir === b.isDir) return a.name.localeCompare(b.name);
      return a.isDir ? -1 : 1;
    });
    n.children.forEach(sortRec);
  };
  sortRec(root);
  return root.children;
}

interface TreeCtx {
  expanded: Set<string>;
  toggle: (p: string) => void;
  mainDoc: string;
  activePath: string | null;
  selected: string | null;
  onSelect: (path: string, isDir: boolean) => void;
  onOpen: (p: string) => void;
  onDelete: (p: string) => void;
  onSetMain: (p: string) => void;
  mainExtensions: string[];
  onCopy: (p: string, isDir: boolean) => void;
  onImport: (destDir: string, mode: "file" | "dir") => void;
  renamePath: string | null;
  renameValue: string;
  onStartRename: (path: string, name: string) => void;
  onChangeRename: (v: string) => void;
  onCommitRename: (path: string) => void;
  onCancelRename: () => void;
  newMode: NewEntryMode;
  newParent: string;
  newValue: string;
  onStartNew: (parent: string, mode: "file" | "dir") => void;
  onChangeNew: (v: string) => void;
  onSubmitNew: (
    reason: NewEntryFinalizeReason,
    renderedParent: string,
  ) => void;
  onCancelNew: () => void;
  dragOver: string | null;
  setDragOver: (p: string | null) => void;
  onMove: (from: string, toDir: string) => void;
}

export function FileTree({
  collapsed: controlledCollapsed,
  onCollapsedChange,
}: Readonly<{
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}> = {}) {
  const { t } = useTranslation(["common", "workspace"]);
  const projectId = useFilesStore((s) => s.projectId);
  const tree = useFilesStore((s) => s.tree);
  const mainDoc = useFilesStore((s) => s.mainDoc);
  const activePath = useFilesStore((s) => s.activePath);
  const openFile = useFilesStore((s) => s.openFile);
  const createFile = useFilesStore((s) => s.createFile);
  const deleteEntry = useFilesStore((s) => s.deleteEntry);
  const renameEntry = useFilesStore((s) => s.renameEntry);
  const copyEntry = useFilesStore((s) => s.copyEntry);
  const importPaths = useFilesStore((s) => s.importPaths);
  const setMainDoc = useFilesStore((s) => s.setMainDoc);
  const engineLoaded = useFilesStore((s) => s.engineLoaded);
  const sourceExtensions = useFilesStore((s) => s.engine.source_extensions);
  const hiddenFilePatterns = useSettingsStore((s) => s.hiddenFilePatterns);
  const mainExtensions = engineLoaded ? sourceExtensions : EMPTY_EXTENSIONS;

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [uncontrolledCollapsed, setUncontrolledCollapsed] = useState(false);
  const [selected, setSelected] = useState<{ path: string; isDir: boolean } | null>(null);
  const [newMode, setNewMode] = useState<NewEntryMode>(null);
  const [newParent, setNewParent] = useState("");
  const [newValue, setNewValue] = useState("");
  const [renamePath, setRenamePath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [dragOver, setDragOver] = useState<string | null>(null);
  const interactionRevision = useRef({
    expanded: 0,
    selected: 0,
    draft: 0,
    dragOver: 0,
  });
  const draftIntent = useRef<NewEntryDraft>({
    mode: null,
    parent: "",
    value: "",
  });
  const renameOperationsInFlight = useRef(new Map<number, number>());
  const [conflict, setConflict] = useState<
    | {
        op: "rename";
        from: string;
        to: string;
        suggestedDestination: string;
      }
    | {
        op: "create";
        to: string;
        isDir: boolean;
        suggestedDestination: string;
      }
    | null
  >(null);
  const [resolvingConflict, setResolvingConflict] = useState(false);
  const closeConflict = () => {
    if (!resolvingConflict) setConflict(null);
  };
  const {
    dialogRef: conflictDialogRef,
    onBackdropMouseDown: onConflictBackdropMouseDown,
  } = useModalAccessibility<HTMLDivElement>(conflict !== null, closeConflict);

  const nodes = useMemo(
    () =>
      buildTree(
        tree.filter(
          (entry) => !fileTreePathIsHidden(entry.path, hiddenFilePatterns),
        ),
      ),
    [hiddenFilePatterns, tree],
  );
  const directories = useMemo(() => directoryPaths(nodes), [nodes]);
  const collapsed = controlledCollapsed ?? uncontrolledCollapsed;

  const previousProjectId = useRef(projectId);
  const projectSession = useRef(0);
  useEffect(() => {
    // A project switch replaces the complete file tree. Clear every local
    // interaction state then, and prune state whose path disappeared after a
    // same-project refresh, so an old selection cannot target another file.
    if (previousProjectId.current !== projectId) {
      previousProjectId.current = projectId;
      projectSession.current += 1;
      setExpanded(new Set());
      setSelected(null);
      setNewMode(null);
      setNewParent("");
      setNewValue("");
      draftIntent.current = { mode: null, parent: "", value: "" };
      setRenamePath(null);
      setRenameValue("");
      setDragOver(null);
      setConflict(null);
      setResolvingConflict(false);
      return;
    }

    const validPaths = new Set<string>();
    const visit = (entries: readonly TreeNode[]) => {
      for (const entry of entries) {
        validPaths.add(entry.path);
        visit(entry.children);
      }
    };
    visit(nodes);

    setExpanded((current) =>
      new Set([...current].filter((path) => directories.has(path))),
    );
    setSelected((current) =>
      current && validPaths.has(current.path) ? current : null,
    );
    setRenamePath((current) =>
      current && validPaths.has(current) ? current : null,
    );
    setDragOver((current) =>
      current === ROOT || (current && directories.has(current)) ? current : null,
    );
    setNewMode((current) =>
      current && newParent && !directories.has(newParent) ? null : current,
    );
    if (newParent && !directories.has(newParent)) {
      setNewParent("");
      setNewValue("");
    }
    setConflict((current) => {
      if (!current) return null;
      if (current.op === "rename") {
        return validPaths.has(current.from) ? current : null;
      }
      const parent = parentOf(current.to);
      return !parent || directories.has(parent) ? current : null;
    });
  }, [directories, newParent, nodes, projectId]);

  const interactionPaths = () => ({
    expanded,
    selected,
    draft: { mode: newMode, parent: newParent, value: newValue },
    dragOver,
  });
  const currentInteractionRevision = () => ({ ...interactionRevision.current });
  const markInteraction = (kind: keyof typeof interactionRevision.current) => {
    interactionRevision.current[kind] += 1;
  };
  const currentProjectOperation = (token: {
    projectId: string | null;
    session: number;
  }) =>
    token.session === projectSession.current &&
    useFilesStore.getState().projectId === token.projectId;
  const trackRenameOperation = (session: number, delta: 1 | -1) => {
    const count = (renameOperationsInFlight.current.get(session) ?? 0) + delta;
    if (count > 0) renameOperationsInFlight.current.set(session, count);
    else renameOperationsInFlight.current.delete(session);
  };

  const restoreRemappedInteractionPaths = (
    from: string,
    to: string,
    previous: ReturnType<typeof interactionPaths>,
    startedAt: ReturnType<typeof currentInteractionRevision>,
  ) => {
    const changed = (kind: keyof typeof interactionRevision.current) =>
      interactionRevision.current[kind] !== startedAt[kind];
    const sourceDraft = changed("draft") ? draftIntent.current : previous.draft;
    const remappedDraft = {
      ...sourceDraft,
      parent: remapTreePath(sourceDraft.parent, from, to),
    };
    setExpanded((current) => {
      const next = new Set(
        [...(changed("expanded") ? current : previous.expanded)].map((path) =>
          remapTreePath(path, from, to),
        ),
      );
      // A nested draft is only mounted inside its expanded parent. Starting
      // the draft expanded that parent, so preserve that visibility through
      // the transient pruning caused by the rename refresh.
      if (remappedDraft.mode && remappedDraft.parent) {
        next.add(remappedDraft.parent);
      }
      return next;
    });
    setSelected((current) => {
      const value = changed("selected") ? current : previous.selected;
      return value
        ? {
            ...value,
            path: remapTreePath(value.path, from, to),
          }
        : null;
    });
    draftIntent.current = remappedDraft;
    setNewMode(remappedDraft.mode);
    setNewParent(remappedDraft.parent);
    setNewValue(remappedDraft.value);
    setDragOver((current) => {
      const value = changed("dragOver") ? current : previous.dragOver;
      return value && value !== ROOT ? remapTreePath(value, from, to) : value;
    });
  };

  const expand = (p: string) => {
    markInteraction("expanded");
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(p);
      return next;
    });
  };

  const toggle = (path: string) => {
    markInteraction("expanded");
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  };

  const select = (path: string, isDir: boolean) => {
    markInteraction("selected");
    setSelected({ path, isDir });
  };

  const updateDragOver = (path: string | null) => {
    markInteraction("dragOver");
    setDragOver(path);
  };

  const renameOrPrompt = async (from: string, to: string, action: "rename" | "move") => {
    const previousInteractionPaths = interactionPaths();
    const startedAt = currentInteractionRevision();
    const operation = { projectId, session: projectSession.current };
    trackRenameOperation(operation.session, 1);
    try {
      const destination = await renameEntry(from, to);
      if (!currentProjectOperation(operation)) return null;
      // The store refreshes the tree before this promise resolves. Restore
      // from the pre-operation snapshot so the refresh cannot discard a
      // selected or expanded descendant before its path is remapped.
      restoreRemappedInteractionPaths(
        from,
        destination,
        previousInteractionPaths,
        startedAt,
      );
      return destination;
    } catch (error) {
      if (!currentProjectOperation(operation)) return null;
      if (isFileConflictError(error)) {
        setConflict({ op: "rename", from, to, suggestedDestination: error.suggestedDestination });
      } else {
        notifyError(
          `${action} file`,
          error,
          action === "rename"
            ? i18n.t(($) => $.workspace.files.renameFailed, { path: from })
            : i18n.t(($) => $.workspace.files.moveFailed, { path: from }),
        );
      }
      return null;
    } finally {
      trackRenameOperation(operation.session, -1);
    }
  };

  const resolveConflict = async (strategy: "keep_both" | "replace") => {
    const pending = conflict;
    if (!pending) return;
    const operation = { projectId, session: projectSession.current };
    setResolvingConflict(true);
    try {
      if (pending.op === "create") {
        await createFile(pending.to, pending.isDir, strategy);
        if (!currentProjectOperation(operation)) return;
        setConflict(null);
      } else {
        const previousInteractionPaths = interactionPaths();
        const startedAt = currentInteractionRevision();
        trackRenameOperation(operation.session, 1);
        let destination: string;
        try {
          destination = await renameEntry(pending.from, pending.to, strategy);
        } finally {
          trackRenameOperation(operation.session, -1);
        }
        if (!currentProjectOperation(operation)) return;
        setConflict(null);
        restoreRemappedInteractionPaths(
          pending.from,
          destination,
          previousInteractionPaths,
          startedAt,
        );
        const parent = parentOf(destination);
        if (parent) expand(parent);
      }
    } catch (error) {
      if (!currentProjectOperation(operation)) return;
      if (isFileConflictError(error)) {
        setConflict({
          ...pending,
          suggestedDestination: error.suggestedDestination,
        });
      } else {
        notifyError(
          "resolve file conflict",
          error,
          i18n.t(($) => $.workspace.files.conflict.unchanged),
        );
      }
    } finally {
      if (currentProjectOperation(operation)) setResolvingConflict(false);
    }
  };

  const commitRename = async (oldPath: string) => {
    const newName = renameValue.trim();
    setRenamePath(null);
    setRenameValue("");
    if (!newName) return;
    const dir = parentOf(oldPath);
    const to = dir ? `${dir}/${newName}` : newName;
    if (to === oldPath) return;
    const destination = await renameOrPrompt(oldPath, to, "rename");
    if (!destination) return;
  };

  const startNew = (parent: string, mode: "file" | "dir") => {
    if (parent) expand(parent);
    markInteraction("draft");
    draftIntent.current = { mode, parent, value: "" };
    setNewParent(parent);
    setNewValue("");
    setNewMode(mode);
  };

  const changeNewValue = (value: string) => {
    markInteraction("draft");
    draftIntent.current = { ...draftIntent.current, value };
    setNewValue(value);
  };

  const clearNewDraft = () => {
    markInteraction("draft");
    draftIntent.current = { mode: null, parent: "", value: "" };
    setNewMode(null);
    setNewParent("");
    setNewValue("");
  };

  const targetDir = () => {
    if (!selected) return "";
    return selected.isDir ? selected.path : parentOf(selected.path);
  };

  const submitNew = async (
    reason: NewEntryFinalizeReason,
    renderedParent: string,
  ) => {
    // Refreshing the tree during a rename temporarily unmounts a draft whose
    // parent still has its old path. That focus loss is structural, not a user
    // request to create the old path, so let the rename restore and remap it.
    if (
      reason === "blur" &&
      ((renameOperationsInFlight.current.get(projectSession.current) ?? 0) > 0 ||
        renderedParent !== draftIntent.current.parent)
    ) {
      return;
    }
    const { mode, parent, value } = draftIntent.current;
    const name = value.trim();
    clearNewDraft();
    if (!name || !mode) return;
    const path = parent ? `${parent}/${name}` : name;
    const operation = { projectId, session: projectSession.current };
    try {
      await createFile(path, mode === "dir");
      if (!currentProjectOperation(operation)) return;
      if (mode === "dir") expand(path);
    } catch (e) {
      if (!currentProjectOperation(operation)) return;
      if (isFileConflictError(e)) {
        setConflict({
          op: "create",
          to: path,
          isDir: mode === "dir",
          suggestedDestination: e.suggestedDestination,
        });
      } else {
        notifyError("create file", e, i18n.t(($) => $.workspace.files.createFailed, { path }));
      }
    }
  };

  const cancelNew = () => {
    clearNewDraft();
  };

  const move = async (from: string, toDir: string) => {
    const base = from.split("/").pop() ?? from;
    const to = toDir ? `${toDir}/${base}` : base;
    if (to === from) return;
    if (toDir === from || toDir.startsWith(`${from}/`)) return; // into itself / a descendant
    const destination = await renameOrPrompt(from, to, "move");
    if (destination) {
      if (toDir) expand(toDir);
    }
  };

  const importInto = async (destDir: string, mode: "file" | "dir") => {
    const operation = { projectId, session: projectSession.current };
    const sources = await pickImportSources(mode);
    if (sources.length === 0 || !currentProjectOperation(operation)) return;
    await importPaths(destDir, sources);
    if (!currentProjectOperation(operation)) return;
    if (destDir) expand(destDir);
  };

  const ctx: TreeCtx = {
    expanded,
    toggle,
    mainDoc,
    activePath,
    selected: selected?.path ?? null,
    onSelect: select,
    onOpen: (path) => {
      // Opening a file from the tree brings the editor forward if a layout was
      // hiding it (AI-only or preview-only), then shows the file.
      useSettingsStore.getState().revealEditor();
      return openFile(path);
    },
    onDelete: (path) => {
      void deleteEntry(path).catch((error) =>
        notifyError("delete file", error, i18n.t(($) => $.workspace.files.deleteFailed, { path })),
      );
    },
    onSetMain: (path) => {
      void setMainDoc(path).catch(() => {
        if (useFilesStore.getState().mainDoc === path) return;
        toast.error(i18n.t(($) => $.workspace.files.setMainFailed, { path }));
      });
    },
    mainExtensions,
    onCopy: copyEntry,
    onImport: (destDir, mode) => void importInto(destDir, mode),
    renamePath,
    renameValue,
    onStartRename: (p, name) => {
      setRenamePath(p);
      setRenameValue(name);
    },
    onChangeRename: setRenameValue,
    onCommitRename: commitRename,
    onCancelRename: () => {
      setRenamePath(null);
      setRenameValue("");
    },
    newMode,
    newParent,
    newValue,
    onStartNew: startNew,
    onChangeNew: changeNewValue,
    onSubmitNew: submitNew,
    onCancelNew: cancelNew,
    dragOver,
    setDragOver: updateDragOver,
    onMove: move,
  };

  const sourceActions = (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        title={t(
          expanded.size > 0
            ? ($) => $.workspace.files.collapseAll
            : ($) => $.workspace.files.expandAll,
        )}
        aria-label={t(
          expanded.size > 0
            ? ($) => $.workspace.files.collapseAll
            : ($) => $.workspace.files.expandAll,
        )}
        disabled={directories.size === 0}
        onClick={() => {
          markInteraction("expanded");
          setExpanded(expanded.size > 0 ? new Set() : new Set(directories));
        }}
      >
        {expanded.size > 0 ? (
          <CopyMinus aria-hidden className="size-3.5" />
        ) : (
          <CopyPlus aria-hidden className="size-3.5" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        title={t(($) => $.workspace.files.newFileTitle)}
        aria-label={t(($) => $.workspace.files.newFileAriaLabel)}
        onClick={() => startNew(targetDir(), "file")}
      >
        <FilePlus className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        title={t(($) => $.workspace.files.newFolderTitle)}
        aria-label={t(($) => $.workspace.files.newFolderAriaLabel)}
        onClick={() => startNew(targetDir(), "dir")}
      >
        <FolderPlus className="size-3.5" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title={t(($) => $.workspace.files.importTitle)}
            aria-label={t(($) => $.workspace.files.importAriaLabel)}
          >
            <Import className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={() => ctx.onImport(targetDir(), "file")}>
            <FilePlus className="size-4 text-muted-foreground" /> {t(($) => $.workspace.files.importFiles)}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => ctx.onImport(targetDir(), "dir")}>
            <FolderPlus className="size-4 text-muted-foreground" /> {t(($) => $.workspace.files.importFolder)}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  return (
    <>
      <SidebarSection
        id="source-tree"
        title={t(($) => $.workspace.files.title)}
        icon={<FolderClosed aria-hidden className="size-3.5 shrink-0" />}
        open={!collapsed}
        onOpenChange={(open) => {
          const next = !open;
          setUncontrolledCollapsed(next);
          onCollapsedChange?.(next);
        }}
        className={collapsed ? "shrink-0" : "h-full flex-1"}
        contentClassName="flex min-h-0 flex-1 flex-col pb-0"
        actions={sourceActions}
      >
        {/* The whole list is a drop target for moving entries back to the root. */}
        <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            role="tree"
            aria-label={t(($) => $.workspace.files.treeAriaLabel)}
            className={cn(
              "flex-1 overflow-auto p-1.5",
              dragOver === ROOT && "rounded-md bg-primary/10"
            )}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes("text/plain")) return;
              e.preventDefault();
              updateDragOver(ROOT);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const from = e.dataTransfer.getData("text/plain");
              updateDragOver(null);
              if (from) void move(from, "");
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                updateDragOver(null);
              }
            }}
          >
            {newMode && newParent === "" && (
              <NewEntryInput
                mode={newMode}
                value={newValue}
                depth={0}
                parentPath=""
                onChange={ctx.onChangeNew}
                onSubmit={(reason) => ctx.onSubmitNew(reason, "")}
                onCancel={ctx.onCancelNew}
              />
            )}
            {nodes.map((n) => (
              <TreeRow key={n.path} node={n} depth={0} ctx={ctx} />
            ))}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-52" onCloseAutoFocus={(e) => e.preventDefault()}>
          <ContextMenuItem onClick={() => ctx.onStartNew("", "file")}>
            <FilePlus className="mr-2 size-4" /> {t(($) => $.workspace.files.newFile)}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => ctx.onStartNew("", "dir")}>
            <FolderPlus className="mr-2 size-4" /> {t(($) => $.workspace.files.newFolder)}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => ctx.onImport("", "file")}>
            <Import className="mr-2 size-4" /> {t(($) => $.workspace.files.importFiles)}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => ctx.onImport("", "dir")}>
            <Import className="mr-2 size-4" /> {t(($) => $.workspace.files.importFolder)}
          </ContextMenuItem>
        </ContextMenuContent>
        </ContextMenu>

        <LinkedFoldersSection />

        <TaskOutputsSection />
      </SidebarSection>

      {conflict && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <button
            type="button"
            aria-label={t(($) => $.workspace.files.conflict.cancelAriaLabel)}
            className="absolute inset-0"
            onMouseDown={onConflictBackdropMouseDown}
          />
          <div
            ref={conflictDialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-label={t(($) => $.workspace.files.conflict.dialogAriaLabel)}
            tabIndex={-1}
            className="relative w-full max-w-md rounded-xl border bg-background p-5 shadow-2xl"
          >
            <h2 className="text-sm font-semibold">{t(($) => $.workspace.files.conflict.title)}</h2>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              <Trans
                ns="workspace"
                i18nKey={
                  conflict.op === "rename"
                    ? ($) => $.workspace.files.conflict.renameBody
                    : ($) => $.workspace.files.conflict.createBody
                }
                values={{
                  destination: conflict.to,
                  suggestion: conflict.suggestedDestination,
                }}
                components={{
                  destination: <span className="font-medium text-foreground" />,
                  suggestion: <span className="font-medium text-foreground" />,
                }}
              />
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={closeConflict}
                disabled={resolvingConflict}
                data-modal-initial-focus
              >
                {t(($) => $.common.actions.cancel)}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void resolveConflict("keep_both")}
                disabled={resolvingConflict}
              >
                {t(($) => $.workspace.files.conflict.keepBoth)}
              </Button>
              {conflict.op === "rename" && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => void resolveConflict("replace")}
                  disabled={resolvingConflict}
                >
                  {t(($) => $.workspace.files.conflict.replace)}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function useFinalizeOnce(
  onSubmit: (reason: NewEntryFinalizeReason) => void,
  onCancel: () => void,
) {
  const finalizedRef = useRef(false);
  return {
    submitOnce: (reason: NewEntryFinalizeReason) => {
      if (finalizedRef.current) return;
      finalizedRef.current = true;
      onSubmit(reason);
    },
    cancelOnce: () => {
      if (finalizedRef.current) return;
      finalizedRef.current = true;
      onCancel();
    },
  };
}

export function NewEntryInput({
  mode,
  value,
  depth,
  parentPath,
  onChange,
  onSubmit,
  onCancel,
}: Readonly<{
  mode: "file" | "dir";
  value: string;
  depth: number;
  parentPath: string;
  onChange: (v: string) => void;
  onSubmit: (reason: NewEntryFinalizeReason) => void;
  onCancel: () => void;
}>) {
  const { t } = useTranslation(["workspace"]);
  const inputRef = useInitialFocus<HTMLInputElement>();
  const inputId = useId();
  const { submitOnce, cancelOnce } = useFinalizeOnce(onSubmit, onCancel);
  const newEntryLabel = () => {
    if (parentPath) {
      return mode === "dir"
        ? t(($) => $.workspace.files.newEntry.folderInFolder, { folder: parentPath })
        : t(($) => $.workspace.files.newEntry.fileInFolder, { folder: parentPath });
    }
    return mode === "dir"
      ? t(($) => $.workspace.files.newEntry.folderInRoot)
      : t(($) => $.workspace.files.newEntry.fileInRoot);
  };
  return (
    <div style={{ paddingLeft: `${depth * 12 + 8}px` }} className="py-0.5">
      <label htmlFor={inputId} className="sr-only">
        {newEntryLabel()}
      </label>
      <Input
        id={inputId}
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => submitOnce("blur")}
        onKeyDown={(e) => {
          if (e.key === "Enter") submitOnce("enter");
          if (e.key === "Escape") cancelOnce();
        }}
        placeholder={
          mode === "dir"
            ? t(($) => $.workspace.files.newEntry.folderPlaceholder)
            : t(($) => $.workspace.files.newEntry.filePlaceholder)
        }
        className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      />
    </div>
  );
}

export function RenameEntryInput({
  value,
  depth,
  onChange,
  onSubmit,
  onCancel,
}: Readonly<{
  value: string;
  depth: number;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}>) {
  const { t } = useTranslation(["workspace"]);
  const inputRef = useInitialFocus<HTMLInputElement>();
  const { submitOnce, cancelOnce } = useFinalizeOnce(
    () => onSubmit(),
    onCancel,
  );

  return (
    <div style={{ paddingLeft: `${depth * 12 + 0}px` }} className="py-0.5">
      <Input
        ref={inputRef}
        aria-label={t(($) => $.workspace.files.renameAriaLabel)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => submitOnce("blur")}
        onKeyDown={(e) => {
          if (e.key === "Enter") submitOnce("enter");
          if (e.key === "Escape") cancelOnce();
        }}
        onClick={(e) => e.stopPropagation()}
        className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm outline-none"
      />
    </div>
  );
}

function TreeRow({ node, depth, ctx }: Readonly<{ node: TreeNode; depth: number; ctx: TreeCtx }>) {
  const { t } = useTranslation(["common", "workspace"]);
  const isOpen = ctx.expanded.has(node.path) || !node.isDir;
  const isActive = ctx.activePath === node.path;
  const isSelected = ctx.selected === node.path;
  const isMain = ctx.mainDoc === node.path;
  const isRenaming = ctx.renamePath === node.path;
  const isDropTarget = ctx.dragOver === node.path && node.isDir;
  const rowRef = useRef<HTMLDivElement>(null);

  // Dropping onto a folder targets that folder; onto a file targets its folder.
  const dropDir = node.isDir ? node.path : parentOf(node.path);

  const openRowMenu = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    rowRef.current?.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: rect.left,
        clientY: rect.bottom,
      })
    );
  };

  const activate = () => {
    ctx.onSelect(node.path, node.isDir);
    node.isDir ? ctx.toggle(node.path) : ctx.onOpen(node.path);
  };

  const onRowKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate();
    } else if (
      node.isDir &&
      ((e.key === "ArrowRight" && !ctx.expanded.has(node.path)) ||
        (e.key === "ArrowLeft" && ctx.expanded.has(node.path)))
    ) {
      e.preventDefault();
      ctx.toggle(node.path);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const items = Array.from(
        e.currentTarget
          .closest('[role="tree"]')
          ?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []
      );
      const idx = items.indexOf(e.currentTarget);
      const next = e.key === "ArrowDown" ? items[idx + 1] : items[idx - 1];
      next?.focus();
    }
  };

  const onDragStart = (e: ReactDragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData("text/plain", node.path);
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragOver = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes("text/plain")) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    ctx.setDragOver(dropDir || ROOT);
  };
  const onDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const from = e.dataTransfer.getData("text/plain");
    ctx.setDragOver(null);
    if (from) ctx.onMove(from, dropDir);
  };

  const content = (
    <div
      ref={rowRef}
      role="treeitem"
      data-path={node.path}
      data-main-document={isMain ? "true" : "false"}
      tabIndex={0}
      draggable={!isRenaming}
      aria-expanded={node.isDir ? ctx.expanded.has(node.path) : undefined}
      aria-selected={isActive || isSelected}
      className={cn(
        "group flex cursor-pointer items-center gap-1.5 rounded-md py-1.5 pr-2 text-sm text-sidebar-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-1 focus-visible:ring-ring",
        isActive && "bg-sidebar-accent",
        isSelected && !isActive && "bg-sidebar-accent/60",
        isDropTarget && "bg-primary/15"
      )}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      onClick={activate}
      onKeyDown={onRowKeyDown}
      onDragStart={onDragStart}
      onDragEnd={() => ctx.setDragOver(null)}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {node.isDir ? (
        <>
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              ctx.expanded.has(node.path) && "rotate-90"
            )}
          />
          {ctx.expanded.has(node.path) ? (
            <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <Folder className="size-4 shrink-0 text-muted-foreground" />
          )}
        </>
      ) : (
        <>
          <span className="flex w-3.5 shrink-0 items-center justify-center">
            {isMain && <Star className="size-3 shrink-0 fill-foreground text-foreground" />}
          </span>
          <FileIcon name={node.name} className="size-4 shrink-0" />
        </>
      )}
      <span className="truncate">{node.name}</span>
      <span className="ml-auto flex shrink-0 items-center gap-1">
        <button
          type="button"
          aria-label={t(($) => $.workspace.files.moreActions, { name: node.name })}
          onClick={openRowMenu}
          className="flex size-5 shrink-0 items-center justify-center rounded opacity-0 hover:bg-sidebar-accent-foreground/10 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      </span>
    </div>
  );

  return (
    <div>
      {isRenaming ? (
        <RenameEntryInput
          value={ctx.renameValue}
          depth={depth}
          onChange={ctx.onChangeRename}
          onSubmit={() => ctx.onCommitRename(node.path)}
          onCancel={ctx.onCancelRename}
        />
      ) : (
        <ContextMenu>
          <ContextMenuTrigger asChild>{content}</ContextMenuTrigger>
          <ContextMenuContent className="w-52" onCloseAutoFocus={(e) => e.preventDefault()}>
            {node.isDir ? (
              <>
                <ContextMenuItem onClick={() => ctx.onStartNew(node.path, "file")}>
                  <FilePlus className="mr-2 size-4" /> {t(($) => $.workspace.files.newFile)}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => ctx.onStartNew(node.path, "dir")}>
                  <FolderPlus className="mr-2 size-4" /> {t(($) => $.workspace.files.newFolder)}
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => ctx.onImport(node.path, "file")}>
                  <Import className="mr-2 size-4" /> {t(($) => $.workspace.files.importFiles)}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => ctx.onImport(node.path, "dir")}>
                  <Import className="mr-2 size-4" /> {t(($) => $.workspace.files.importFolder)}
                </ContextMenuItem>
              </>
            ) : (
              <>
                <ContextMenuItem onClick={() => ctx.onOpen(node.path)}>
                  {t(($) => $.common.actions.open)}
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={!ctx.mainExtensions.some((extension) =>
                    node.path.toLowerCase().endsWith(`.${extension.toLowerCase()}`),
                  )}
                  onClick={() => ctx.onSetMain(node.path)}
                >
                  {t(($) => $.workspace.files.setMain)}
                </ContextMenuItem>
              </>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => ctx.onStartRename(node.path, node.name)}>
              <Pencil className="mr-2 size-4" /> {t(($) => $.common.actions.rename)}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => ctx.onCopy(node.path, node.isDir)}>
              <CopyPlus className="mr-2 size-4" /> {t(($) => $.workspace.files.makeCopy)}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => {
                if (
                  window.confirm(
                    t(($) => $.workspace.files.confirmDelete, { path: node.path }),
                  )
                )
                  ctx.onDelete(node.path);
              }}
            >
              <Trash2 className="mr-2 size-4" /> {t(($) => $.common.actions.delete)}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )}
      {node.isDir && ctx.expanded.has(node.path) && (
        // A WAI-ARIA tree uses role=group for nested treeitems. A fieldset
        // would add unrelated form-group semantics and browser chrome.
        // biome-ignore lint/a11y/useSemanticElements: tree ownership requires this ARIA role
        <div role="group">
          {ctx.newMode && ctx.newParent === node.path && (
            <NewEntryInput
              mode={ctx.newMode}
              value={ctx.newValue}
              depth={depth + 1}
              parentPath={node.path}
              onChange={ctx.onChangeNew}
              onSubmit={(reason) => ctx.onSubmitNew(reason, node.path)}
              onCancel={ctx.onCancelNew}
            />
          )}
          {isOpen &&
            node.children.map((c) => (
              <TreeRow key={c.path} node={c} depth={depth + 1} ctx={ctx} />
            ))}
        </div>
      )}
    </div>
  );
}
