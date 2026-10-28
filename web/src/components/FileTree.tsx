import { ChevronRight, File, FileText, Folder, FolderOpen, ImageIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import type { WebFile } from "../protocol";

export interface TreeNode {
  name: string;
  path: string;
  file: WebFile | null;
  children: TreeNode[];
}

const IMAGE = /\.(?:png|jpe?g|gif|webp|svg|bmp|avif)$/iu;

export function isImagePath(path: string): boolean {
  return IMAGE.test(path);
}

function sortNodes(nodes: TreeNode[]): TreeNode[] {
  nodes.sort((a, b) => {
    const aFolder = a.file === null || a.file.kind === "dir";
    const bFolder = b.file === null || b.file.kind === "dir";
    if (aFolder !== bFolder) return aFolder ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const node of nodes) sortNodes(node.children);
  return nodes;
}

export function buildTree(files: readonly WebFile[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", file: null, children: [] };
  const folders = new Map<string, TreeNode>([["", root]]);
  const folderFor = (path: string): TreeNode => {
    const known = folders.get(path);
    if (known) return known;
    const slash = path.lastIndexOf("/");
    const parent = folderFor(slash < 0 ? "" : path.slice(0, slash));
    const node: TreeNode = { name: path.slice(slash + 1), path, file: null, children: [] };
    parent.children.push(node);
    folders.set(path, node);
    return node;
  };
  for (const file of files) {
    const path = file.path.replace(/^\/+|\/+$/gu, "");
    if (!path) continue;
    if (file.kind === "dir") {
      folderFor(path).file = file;
      continue;
    }
    const slash = path.lastIndexOf("/");
    const parent = folderFor(slash < 0 ? "" : path.slice(0, slash));
    parent.children.push({ name: path.slice(slash + 1), path, file, children: [] });
  }
  return sortNodes(root.children);
}

function FileIcon({ file }: Readonly<{ file: WebFile }>) {
  if (file.kind === "text") return <FileText aria-hidden className="size-3.5 shrink-0" />;
  if (isImagePath(file.path)) return <ImageIcon aria-hidden className="size-3.5 shrink-0" />;
  return <File aria-hidden className="size-3.5 shrink-0" />;
}

function Branch({
  nodes,
  depth,
  activeFileId,
  collapsed,
  onToggle,
  onOpen,
}: Readonly<{
  nodes: readonly TreeNode[];
  depth: number;
  activeFileId: string | null;
  collapsed: ReadonlySet<string>;
  onToggle: (path: string) => void;
  onOpen: (fileId: string) => void;
}>) {
  return (
    <ul className="space-y-px">
      {nodes.map((node) => {
        const indent = { paddingLeft: `${0.5 + depth * 0.75}rem` };
        if (node.file === null || node.file.kind === "dir") {
          const open = !collapsed.has(node.path);
          return (
            <li key={`dir:${node.path}`}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => onToggle(node.path)}
                style={indent}
                className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:bg-sidebar-accent"
              >
                <ChevronRight aria-hidden className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")} />
                {open ? (
                  <FolderOpen aria-hidden className="size-3.5 shrink-0" />
                ) : (
                  <Folder aria-hidden className="size-3.5 shrink-0" />
                )}
                <span className="truncate">{node.name}</span>
              </button>
              {open && node.children.length > 0 ? (
                <Branch
                  nodes={node.children}
                  depth={depth + 1}
                  activeFileId={activeFileId}
                  collapsed={collapsed}
                  onToggle={onToggle}
                  onOpen={onOpen}
                />
              ) : null}
            </li>
          );
        }
        const file = node.file;
        const active = file.fileId === activeFileId;
        return (
          <li key={file.fileId}>
            <button
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => onOpen(file.fileId)}
              style={{ paddingLeft: `${1.25 + depth * 0.75}rem` }}
              title={node.path}
              className={cn(
                "flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs transition-colors focus-visible:bg-sidebar-accent",
                active
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-foreground/85 hover:bg-sidebar-accent/70",
              )}
            >
              <FileIcon file={file} />
              <span className="truncate">{node.name}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function FileTree({
  files,
  activeFileId,
  onOpen,
}: Readonly<{ files: readonly WebFile[]; activeFileId: string | null; onOpen: (fileId: string) => void }>) {
  const { t } = useTranslation(["web"]);
  const tree = useMemo(() => buildTree(files), [files]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (path: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  if (tree.length === 0) {
    return <EmptyState size="compact" className="flex-1 px-4 py-8" description={t(($) => $.web.files.empty)} />;
  }
  return (
    <nav aria-label={t(($) => $.web.files.tree)} className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
      <Branch nodes={tree} depth={0} activeFileId={activeFileId} collapsed={collapsed} onToggle={toggle} onOpen={onOpen} />
    </nav>
  );
}
