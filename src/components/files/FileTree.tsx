import {
  useMemo,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  ChevronRight,
  CopyPlus,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderTree,
  Pencil,
  Star,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useFilesStore } from "@/store/files";
import { FileIcon } from "@/components/files/fileIcon";
import { logError } from "@/lib/log";
import { cn } from "@/lib/utils";

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
}

/** The parent directory of a path ("" for a top-level entry). */
function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}

const ROOT = "__root__";

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
  // folders first, then alphabetical
  const sortRec = (n: TreeNode) => {
    n.children.sort((a, b) =>
      a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1
    );
    n.children.forEach(sortRec);
  };
  sortRec(root);
  return root.children;
}

/** Everything a row needs, bundled so the recursion stays readable. */
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
  onCopy: (p: string, isDir: boolean) => void;
  // rename (inline)
  renamePath: string | null;
  renameValue: string;
  onStartRename: (path: string, name: string) => void;
  onChangeRename: (v: string) => void;
  onCommitRename: (path: string) => void;
  onCancelRename: () => void;
  // create new (inline, inside a folder or at root)
  newMode: null | "file" | "dir";
  newParent: string;
  newValue: string;
  onStartNew: (parent: string, mode: "file" | "dir") => void;
  onChangeNew: (v: string) => void;
  onSubmitNew: () => void;
  onCancelNew: () => void;
  // drag & drop move
  dragOver: string | null;
  setDragOver: (p: string | null) => void;
  onMove: (from: string, toDir: string) => void;
}

export function FileTree() {
  const tree = useFilesStore((s) => s.tree);
  const mainDoc = useFilesStore((s) => s.mainDoc);
  const activePath = useFilesStore((s) => s.activePath);
  const openFile = useFilesStore((s) => s.openFile);
  const createFile = useFilesStore((s) => s.createFile);
  const deleteEntry = useFilesStore((s) => s.deleteEntry);
  const renameEntry = useFilesStore((s) => s.renameEntry);
  const copyEntry = useFilesStore((s) => s.copyEntry);
  const setMainDoc = useFilesStore((s) => s.setMainDoc);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<{ path: string; isDir: boolean } | null>(null);
  const [newMode, setNewMode] = useState<null | "file" | "dir">(null);
  const [newParent, setNewParent] = useState("");
  const [newValue, setNewValue] = useState("");
  const [renamePath, setRenamePath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [dragOver, setDragOver] = useState<string | null>(null);

  const nodes = useMemo(() => buildTree(tree), [tree]);

  const expand = (p: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(p);
      return next;
    });

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });

  const commitRename = async (oldPath: string) => {
    const newName = renameValue.trim();
    setRenamePath(null);
    setRenameValue("");
    if (!newName) return;
    const dir = parentOf(oldPath);
    const to = dir ? `${dir}/${newName}` : newName;
    if (to === oldPath) return;
    try {
      await renameEntry(oldPath, to);
    } catch (e) {
      void logError("rename file", e);
    }
  };

  // Start an inline new-file/folder input inside `parent` ("" = project root).
  const startNew = (parent: string, mode: "file" | "dir") => {
    if (parent) expand(parent);
    setNewParent(parent);
    setNewValue("");
    setNewMode(mode);
  };

  // Where the toolbar buttons create: the selected folder, the selected file's
  // folder, or the project root when nothing is selected.
  const targetDir = () => {
    if (!selected) return "";
    return selected.isDir ? selected.path : parentOf(selected.path);
  };

  const submitNew = async () => {
    const name = newValue.trim();
    const mode = newMode;
    const parent = newParent;
    setNewMode(null);
    setNewValue("");
    if (!name || !mode) return;
    const path = parent ? `${parent}/${name}` : name;
    try {
      await createFile(path, mode === "dir");
      if (mode === "dir") expand(path);
    } catch (e) {
      void logError("create file", e);
    }
  };

  const cancelNew = () => {
    setNewMode(null);
    setNewValue("");
  };

  // Move (rename) a file or folder into `toDir` ("" = project root).
  const move = async (from: string, toDir: string) => {
    const base = from.split("/").pop() ?? from;
    const to = toDir ? `${toDir}/${base}` : base;
    if (to === from) return; // already there
    if (toDir === from || toDir.startsWith(`${from}/`)) return; // into itself / a descendant
    try {
      await renameEntry(from, to);
      if (toDir) expand(toDir);
    } catch (e) {
      void logError("move file", e);
    }
  };

  const ctx: TreeCtx = {
    expanded,
    toggle,
    mainDoc,
    activePath,
    selected: selected?.path ?? null,
    onSelect: (path, isDir) => setSelected({ path, isDir }),
    onOpen: openFile,
    onDelete: deleteEntry,
    onSetMain: setMainDoc,
    onCopy: copyEntry,
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
    onChangeNew: setNewValue,
    onSubmitNew: submitNew,
    onCancelNew: cancelNew,
    dragOver,
    setDragOver,
    onMove: move,
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 items-center justify-between border-b border-sidebar-border px-3">
        <div className="flex items-center gap-1.5">
          <FolderTree className="size-3.5 text-muted-foreground" />
          <span className="text-xs font-medium uppercase tracking-wide text-sidebar-foreground/70">
            Source Tree
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title="New file (in the selected folder)"
            onClick={() => startNew(targetDir(), "file")}
          >
            <FilePlus className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title="New folder (in the selected folder)"
            onClick={() => startNew(targetDir(), "dir")}
          >
            <FolderPlus className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* The whole list is a drop target for moving entries back to the root. */}
      <div
        role="tree"
        aria-label="Source tree"
        className={cn(
          "flex-1 overflow-auto p-1.5",
          dragOver === ROOT && "rounded-md ring-1 ring-inset ring-primary/40"
        )}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("text/plain")) return;
          e.preventDefault();
          setDragOver(ROOT);
        }}
        onDrop={(e) => {
          e.preventDefault();
          const from = e.dataTransfer.getData("text/plain");
          setDragOver(null);
          if (from) void move(from, "");
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null);
        }}
      >
        {newMode && newParent === "" && (
          <NewEntryInput
            mode={newMode}
            value={newValue}
            depth={0}
            onChange={ctx.onChangeNew}
            onSubmit={ctx.onSubmitNew}
            onCancel={ctx.onCancelNew}
          />
        )}
        {nodes.map((n) => (
          <TreeRow key={n.path} node={n} depth={0} ctx={ctx} />
        ))}
      </div>
    </div>
  );
}

function NewEntryInput({
  mode,
  value,
  depth,
  onChange,
  onSubmit,
  onCancel,
}: {
  mode: "file" | "dir";
  value: string;
  depth: number;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{ paddingLeft: `${depth * 12 + 8}px` }} className="py-0.5">
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onSubmit}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit();
          if (e.key === "Escape") onCancel();
        }}
        placeholder={mode === "dir" ? "New folder name" : "New file name"}
        className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring"
      />
    </div>
  );
}

function TreeRow({ node, depth, ctx }: { node: TreeNode; depth: number; ctx: TreeCtx }) {
  const isOpen = ctx.expanded.has(node.path) || !node.isDir;
  const isActive = ctx.activePath === node.path;
  const isSelected = ctx.selected === node.path;
  const isMain = ctx.mainDoc === node.path;
  const isRenaming = ctx.renamePath === node.path;
  const isDropTarget = ctx.dragOver === node.path && node.isDir;

  // Dropping onto a folder targets that folder; onto a file targets its folder.
  const dropDir = node.isDir ? node.path : parentOf(node.path);

  const activate = () => {
    ctx.onSelect(node.path, node.isDir);
    node.isDir ? ctx.toggle(node.path) : void ctx.onOpen(node.path);
  };

  const onRowKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate();
    } else if (e.key === "ArrowRight" && node.isDir && !ctx.expanded.has(node.path)) {
      e.preventDefault();
      ctx.toggle(node.path);
    } else if (e.key === "ArrowLeft" && node.isDir && ctx.expanded.has(node.path)) {
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
    if (from) void ctx.onMove(from, dropDir);
  };

  const content = (
    <div
      role="treeitem"
      tabIndex={0}
      draggable={!isRenaming}
      aria-expanded={node.isDir ? ctx.expanded.has(node.path) : undefined}
      aria-selected={isActive}
      className={cn(
        "group flex cursor-pointer items-center gap-1.5 rounded-md py-1.5 pr-2 text-sm text-sidebar-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-1 focus-visible:ring-ring",
        isActive && "bg-sidebar-accent",
        isSelected && !isActive && "bg-sidebar-accent/60",
        isDropTarget && "ring-1 ring-inset ring-primary/60 bg-sidebar-accent"
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
          <span className="w-3.5 shrink-0" />
          <FileIcon name={node.name} className="size-4 shrink-0" />
        </>
      )}
      <span className="truncate">{node.name}</span>
      {isMain && <Star className="ml-auto size-3 shrink-0 fill-foreground text-foreground" />}
    </div>
  );

  return (
    <div>
      {isRenaming ? (
        <div style={{ paddingLeft: `${depth * 12 + 0}px` }} className="py-0.5">
          <input
            autoFocus
            aria-label="Rename file"
            value={ctx.renameValue}
            onChange={(e) => ctx.onChangeRename(e.target.value)}
            onBlur={() => ctx.onCommitRename(node.path)}
            onKeyDown={(e) => {
              if (e.key === "Enter") ctx.onCommitRename(node.path);
              if (e.key === "Escape") ctx.onCancelRename();
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm outline-none"
          />
        </div>
      ) : (
        <ContextMenu>
          <ContextMenuTrigger asChild>{content}</ContextMenuTrigger>
          <ContextMenuContent className="w-52">
            {node.isDir ? (
              <>
                <ContextMenuItem onClick={() => ctx.onStartNew(node.path, "file")}>
                  <FilePlus className="mr-2 size-4" /> New file
                </ContextMenuItem>
                <ContextMenuItem onClick={() => ctx.onStartNew(node.path, "dir")}>
                  <FolderPlus className="mr-2 size-4" /> New folder
                </ContextMenuItem>
              </>
            ) : (
              <>
                <ContextMenuItem onClick={() => ctx.onOpen(node.path)}>Open</ContextMenuItem>
                <ContextMenuItem
                  disabled={!node.path.endsWith(".tex")}
                  onClick={() => ctx.onSetMain(node.path)}
                >
                  Set as main document
                </ContextMenuItem>
              </>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => ctx.onStartRename(node.path, node.name)}>
              <Pencil className="mr-2 size-4" /> Rename
            </ContextMenuItem>
            <ContextMenuItem onClick={() => void ctx.onCopy(node.path, node.isDir)}>
              <CopyPlus className="mr-2 size-4" /> Make a copy
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => {
                if (window.confirm(`Delete ${node.path}? This cannot be undone.`))
                  void ctx.onDelete(node.path);
              }}
            >
              <Trash2 className="mr-2 size-4" /> Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )}
      {node.isDir && ctx.expanded.has(node.path) && (
        <>
          {ctx.newMode && ctx.newParent === node.path && (
            <NewEntryInput
              mode={ctx.newMode}
              value={ctx.newValue}
              depth={depth + 1}
              onChange={ctx.onChangeNew}
              onSubmit={ctx.onSubmitNew}
              onCancel={ctx.onCancelNew}
            />
          )}
          {isOpen &&
            node.children.map((c) => (
              <TreeRow key={c.path} node={c} depth={depth + 1} ctx={ctx} />
            ))}
        </>
      )}
    </div>
  );
}
