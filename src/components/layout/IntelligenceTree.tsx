import {
  BookOpenText,
  Braces,
  Box,
  ChevronRight,
  CircleAlert,
  CircleDot,
  FileInput,
  FileText,
  FolderTree,
  Hash,
  Heading,
  Link2,
  Quote,
  Search,
  Sigma,
  Tags,
  X,
} from "lucide-react";
import {
  memo,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent,
  type KeyboardEvent,
  type Ref,
} from "react";
import { FileIcon } from "@/components/files/fileIcon";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type IntelligenceNodeKind =
  | "group"
  | "section"
  | "file"
  | "include"
  | "label"
  | "macro"
  | "environment"
  | "bibentry"
  | "citation"
  | "reference"
  | "math"
  | "warning";

export type IntelligenceNodeTone = "default" | "muted" | "warning" | "danger";

export interface IntelligenceTreeNode {
  id: string;
  label: string;
  kind: IntelligenceNodeKind;
  description?: string;
  provenance?: string;
  badge?: string;
  tone?: IntelligenceNodeTone;
  active?: boolean;
  defaultExpanded?: boolean;
  searchText?: string;
  children?: readonly IntelligenceTreeNode[];
  target?: {
    path: string;
    from: number;
    to: number;
  };
}

interface VisibleTreeRow {
  node: IntelligenceTreeNode;
  level: number;
  parentId: string | null;
  position: number;
  setSize: number;
  expandable: boolean;
  expanded: boolean;
}

const KIND_ICON: Record<
  IntelligenceNodeKind,
  ComponentType<{ className?: string; "aria-hidden"?: boolean }>
> = {
  group: FolderTree,
  section: Heading,
  file: FileText,
  include: FileInput,
  label: Hash,
  macro: Braces,
  environment: Box,
  bibentry: BookOpenText,
  citation: Quote,
  reference: Link2,
  math: Sigma,
  warning: CircleAlert,
};

/** File rows are labelled with the path or the base name; the icon keys off the
 *  base name either way. */
function fileNameOf(node: IntelligenceTreeNode): string {
  const source = node.target?.path ?? node.label;
  return source.slice(source.lastIndexOf("/") + 1);
}

function nodeMatches(node: IntelligenceTreeNode, query: string): boolean {
  if (!query) return true;
  const haystack = [
    node.label,
    node.description ?? "",
    node.provenance ?? "",
    node.badge ?? "",
    node.searchText ?? "",
  ]
    .join("\n")
    .toLocaleLowerCase();
  return haystack.includes(query);
}

function collectVisibleNodeIds(
  nodes: readonly IntelligenceTreeNode[],
  query: string,
  inheritedMatch: boolean,
  visible: Set<string>,
): boolean {
  let branchHasMatch = false;

  for (const node of nodes) {
    const selfMatches = inheritedMatch || nodeMatches(node, query);
    let childMatches = false;
    if (node.children?.length) {
      childMatches = collectVisibleNodeIds(
        node.children,
        query,
        selfMatches,
        visible,
      );
    }
    if (selfMatches || childMatches) {
      visible.add(node.id);
      branchHasMatch = true;
    }
  }

  return branchHasMatch;
}

function flattenVisibleRows(
  nodes: readonly IntelligenceTreeNode[],
  visibleIds: ReadonlySet<string>,
  queryActive: boolean,
  collapsedByUser: ReadonlySet<string>,
  expandedByUser: ReadonlySet<string>,
  level = 1,
  parentId: string | null = null,
  rows: VisibleTreeRow[] = [],
): VisibleTreeRow[] {
  const siblings = nodes.filter((node) => visibleIds.has(node.id));
  const setSize = siblings.length;

  siblings.forEach((node, position) => {
    const expandable = Boolean(node.children?.length);
    const expanded =
      expandable &&
      (queryActive ||
        expandedByUser.has(node.id) ||
        (!collapsedByUser.has(node.id) && node.defaultExpanded !== false));

    rows.push({
      node,
      level,
      parentId,
      position: position + 1,
      setSize,
      expandable,
      expanded,
    });

    if (expanded && node.children) {
      flattenVisibleRows(
        node.children,
        visibleIds,
        queryActive,
        collapsedByUser,
        expandedByUser,
        level + 1,
        node.id,
        rows,
      );
    }
  });

  return rows;
}

function treeDomId(treeId: string, nodeId: string): string {
  let hash = 2166136261;
  const value = `${treeId}\0${nodeId}`;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `intelligence-node-${(hash >>> 0).toString(36)}`;
}

function toneClasses(tone: IntelligenceNodeTone | undefined): string {
  switch (tone) {
    case "danger":
      return "text-destructive";
    case "warning":
      return "text-amber-700 dark:text-amber-300";
    case "muted":
      return "text-muted-foreground";
    default:
      return "text-sidebar-foreground";
  }
}

const TreeRow = memo(function TreeRow({
  row,
  treeId,
  focused,
  setRowRef,
  onFocus,
  onToggle,
  onActivate,
  onKeyDown,
}: {
  row: VisibleTreeRow;
  treeId: string;
  focused: boolean;
  setRowRef: (id: string, element: HTMLDivElement | null) => void;
  onFocus: (id: string) => void;
  onToggle: (id: string, expanded: boolean) => void;
  onActivate: (node: IntelligenceTreeNode) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>, row: VisibleTreeRow) => void;
}) {
  const Icon = KIND_ICON[row.node.kind];
  const isGroup = row.node.kind === "group";
  const linePrefix = row.node.provenance ? `${row.node.provenance}. ` : "";
  const description = row.node.description
    ? `${linePrefix}${row.node.description}`
    : row.node.provenance;
  const accessibleDescription = [row.node.badge, description]
    .filter(Boolean)
    .join(". ");

  const rowElement = (
    <div
      id={treeDomId(treeId, row.node.id)}
      ref={(element) => setRowRef(row.node.id, element)}
      role="treeitem"
      tabIndex={focused ? 0 : -1}
      aria-level={row.level}
      aria-posinset={row.position}
      aria-setsize={row.setSize}
      aria-expanded={row.expandable ? row.expanded : undefined}
      aria-selected={row.node.active || undefined}
      aria-label={
        accessibleDescription
          ? `${row.node.label}. ${accessibleDescription}`
          : row.node.label
      }
      data-intelligence-row={row.node.id}
      className={cn(
        "group flex min-h-7 w-full cursor-pointer items-center gap-1.5 rounded-[5px] py-1 pr-2 text-left text-sm outline-none",
        "hover:bg-sidebar-accent focus-visible:bg-sidebar-accent focus-visible:ring-1 focus-visible:ring-ring",
        "aria-selected:bg-sidebar-accent aria-selected:text-sidebar-accent-foreground",
        "[content-visibility:auto] [contain-intrinsic-size:auto_28px]",
        isGroup && "mt-1 font-medium",
        toneClasses(row.node.tone),
      )}
      style={{ paddingLeft: `${Math.max(6, row.level * 11 - 5)}px` }}
      onFocus={() => onFocus(row.node.id)}
      onKeyDown={(event) => onKeyDown(event, row)}
      onClick={() => {
        if (row.node.target) {
          onActivate(row.node);
        } else if (row.expandable) {
          onToggle(row.node.id, row.expanded);
        }
      }}
    >
      {row.expandable ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={row.expanded ? "Collapse" : "Expand"}
          onClick={(event: MouseEvent<HTMLButtonElement>) => {
            event.stopPropagation();
            onToggle(row.node.id, row.expanded);
          }}
          className="-ml-1.5 -mr-1.5 flex size-7 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground hover:bg-sidebar-accent-foreground/10"
        >
          <ChevronRight
            aria-hidden
            className={cn(
              "size-3.5 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
              row.expanded && "rotate-90",
            )}
          />
        </button>
      ) : (
        <span
          aria-hidden
          className="-ml-1.5 -mr-1.5 flex size-7 shrink-0 items-center justify-center"
        >
          <CircleDot className="size-2 text-muted-foreground/45" />
        </span>
      )}
      {row.node.kind === "file" ? (
        <FileIcon name={fileNameOf(row.node)} className="size-4 shrink-0" />
      ) : (
        <Icon
          aria-hidden
          className={cn(
            "size-4 shrink-0",
            isGroup ? "text-muted-foreground" : "opacity-80",
          )}
        />
      )}
      <span className="min-w-0 flex-1 truncate">{row.node.label}</span>
      {row.node.badge ? (
        <span
          aria-hidden
          className={cn(
            "max-w-[42%] shrink-0 truncate rounded-sm bg-muted px-1 py-px font-mono text-[9px] font-normal leading-4 text-muted-foreground",
            row.node.tone === "warning" &&
              "bg-amber-500/12 text-amber-700 dark:text-amber-300",
            row.node.tone === "danger" &&
              "bg-destructive/10 text-destructive",
          )}
        >
          {row.node.badge}
        </span>
      ) : row.node.provenance ? (
        <span
          aria-hidden
          className="max-w-[42%] shrink-0 truncate font-mono text-[9px] text-muted-foreground/80"
        >
          {row.node.provenance}
        </span>
      ) : null}
    </div>
  );

  // `role="none"` keeps the wrapper out of the accessibility tree so the row
  // stays a direct treeitem child of the tree.
  return description ? (
    <Tooltip label={description} side="right" className="flex w-full" role="none">
      {rowElement}
    </Tooltip>
  ) : (
    rowElement
  );
});

export function IntelligenceTree({
  label,
  nodes,
  query,
  emptyMessage,
  onActivate,
  className,
}: {
  label: string;
  nodes: readonly IntelligenceTreeNode[];
  query: string;
  emptyMessage: string;
  onActivate: (node: IntelligenceTreeNode) => void;
  className?: string;
}) {
  const reactId = useId();
  const treeId = reactId.replaceAll(":", "");
  const normalizedQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const [collapsedByUser, setCollapsedByUser] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [expandedByUser, setExpandedByUser] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  const visibleRows = useMemo(() => {
    const visibleIds = new Set<string>();
    collectVisibleNodeIds(nodes, normalizedQuery, false, visibleIds);
    return flattenVisibleRows(
      nodes,
      visibleIds,
      normalizedQuery.length > 0,
      collapsedByUser,
      expandedByUser,
    );
  }, [collapsedByUser, expandedByUser, nodes, normalizedQuery]);

  const rowIndex = useMemo(
    () => new Map(visibleRows.map((row, index) => [row.node.id, index])),
    [visibleRows],
  );
  const effectiveFocusedId =
    focusedId && rowIndex.has(focusedId)
      ? focusedId
      : (visibleRows[0]?.node.id ?? null);

  useEffect(() => {
    if (focusedId && !rowIndex.has(focusedId)) {
      setFocusedId(visibleRows[0]?.node.id ?? null);
    }
  }, [focusedId, rowIndex, visibleRows]);

  const setRowRef = useCallback(
    (id: string, element: HTMLDivElement | null) => {
      if (element) rowRefs.current.set(id, element);
      else rowRefs.current.delete(id);
    },
    [],
  );

  const focusRow = useCallback((id: string | undefined) => {
    if (!id) return;
    setFocusedId(id);
    rowRefs.current.get(id)?.focus();
  }, []);

  const toggle = useCallback((id: string, expanded: boolean) => {
    startTransition(() => {
      if (expanded) {
        setCollapsedByUser((current) => new Set(current).add(id));
        setExpandedByUser((current) => {
          if (!current.has(id)) return current;
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      } else {
        setExpandedByUser((current) => new Set(current).add(id));
        setCollapsedByUser((current) => {
          if (!current.has(id)) return current;
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
    });
  }, []);

  const onKeyDown = useCallback(
    (
      event: KeyboardEvent<HTMLDivElement>,
      row: VisibleTreeRow,
    ) => {
      const index = rowIndex.get(row.node.id) ?? -1;

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          focusRow(visibleRows[index + 1]?.node.id);
          return;
        case "ArrowUp":
          event.preventDefault();
          focusRow(visibleRows[index - 1]?.node.id);
          return;
        case "Home":
          event.preventDefault();
          focusRow(visibleRows[0]?.node.id);
          return;
        case "End":
          event.preventDefault();
          focusRow(visibleRows.at(-1)?.node.id);
          return;
        case "ArrowRight":
          if (!row.expandable) return;
          event.preventDefault();
          if (!row.expanded) {
            toggle(row.node.id, false);
          } else {
            const child = visibleRows[index + 1];
            if (child?.parentId === row.node.id) focusRow(child.node.id);
          }
          return;
        case "ArrowLeft":
          event.preventDefault();
          if (row.expandable && row.expanded) {
            toggle(row.node.id, true);
          } else if (row.parentId) {
            focusRow(row.parentId);
          }
          return;
        case "Enter":
        case " ":
          event.preventDefault();
          if (row.node.target) {
            onActivate(row.node);
          } else if (row.expandable) {
            toggle(row.node.id, row.expanded);
          }
          return;
        default:
          return;
      }
    },
    [focusRow, onActivate, rowIndex, toggle, visibleRows],
  );

  if (visibleRows.length === 0) {
    return (
      <div
        role="status"
        className={cn(
          "flex min-h-24 items-center justify-center px-5 py-7 text-center text-[11px] leading-relaxed text-muted-foreground",
          className,
        )}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div
      role="tree"
      aria-label={label}
      className={cn("py-1", className)}
    >
      {visibleRows.map((row) => (
        <TreeRow
          key={row.node.id}
          row={row}
          treeId={treeId}
          focused={effectiveFocusedId === row.node.id}
          setRowRef={setRowRef}
          onFocus={setFocusedId}
          onToggle={toggle}
          onActivate={onActivate}
          onKeyDown={onKeyDown}
        />
      ))}
    </div>
  );
}

export function IntelligenceFilter({
  value,
  onChange,
  placeholder = "Filter…",
  label,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const inputId = useId();
  return (
    <div className="relative block rounded-md focus-within:ring-1 focus-within:ring-ring">
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <Search
        aria-hidden
        className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <input
        id={inputId}
        ref={inputRef}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-7 w-full rounded-md border border-input bg-background/70 pl-7 pr-7 text-xs text-foreground placeholder:text-muted-foreground/75 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear filter"
          onClick={() => onChange("")}
          className="absolute right-0 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
        >
          <X aria-hidden className="size-3" />
        </button>
      ) : null}
    </div>
  );
}

export function PanelBreadcrumb({
  project,
  path,
}: {
  project?: string | null;
  path?: string | null;
}) {
  const segments = path?.split("/").filter(Boolean) ?? [];
  const visibleSegments: readonly { id: string; label: string }[] =
    segments.length > 2
      ? [
          { id: `root:${segments[0]}`, label: segments[0] ?? "" },
          { id: "collapsed-path", label: "…" },
          {
            id: `leaf:${segments.at(-1) ?? ""}`,
            label: segments.at(-1) ?? "",
          },
        ]
      : segments.length === 2
        ? [
            { id: `root:${segments[0]}`, label: segments[0] ?? "" },
            { id: `leaf:${segments[1]}`, label: segments[1] ?? "" },
          ]
        : segments.length === 1
          ? [{ id: `leaf:${segments[0]}`, label: segments[0] ?? "" }]
          : [];

  return (
    <nav
      aria-label={
        path
          ? `${project ? `${project}, ` : ""}${path}`
          : (project ?? "No project")
      }
      className="flex min-w-0 items-center gap-1 overflow-hidden text-[10px] text-muted-foreground"
    >
      {project ? (
        <span className="max-w-[40%] shrink truncate font-medium text-sidebar-foreground/75">
          {project}
        </span>
      ) : null}
      {visibleSegments.map((segment, index) => (
        <span
          key={segment.id}
          className="contents"
          aria-hidden
        >
          <ChevronRight className="size-2.5 shrink-0 opacity-50" />
          <span
            className={cn(
              "truncate",
              index === visibleSegments.length - 1 &&
                "font-mono text-sidebar-foreground/75",
            )}
          >
            {segment.label}
          </span>
        </span>
      ))}
    </nav>
  );
}

export function PanelState({
  state,
  title,
  detail,
}: {
  state: "pending" | "partial" | "error" | "unsupported" | "empty";
  title: string;
  detail: string;
}) {
  const isPending = state === "pending";
  const StateIcon =
    state === "error" || state === "partial"
      ? CircleAlert
      : state === "unsupported"
        ? Tags
        : state === "empty"
          ? FolderTree
          : CircleDot;

  return (
    <div
      role={state === "error" ? "alert" : "status"}
      aria-live={isPending ? "polite" : undefined}
      className="flex min-h-36 flex-col items-center justify-center px-6 py-8 text-center"
    >
      <span
        className={cn(
          "mb-3 flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground",
          state === "partial" &&
            "bg-amber-500/10 text-amber-700 dark:text-amber-300",
          state === "error" && "bg-destructive/10 text-destructive",
          isPending && "animate-pulse motion-reduce:animate-none",
        )}
      >
        <StateIcon aria-hidden className="size-4" />
      </span>
      <p className="text-xs font-medium text-sidebar-foreground">{title}</p>
      <p className="mt-1 max-w-60 text-[11px] leading-relaxed text-muted-foreground">
        {detail}
      </p>
    </div>
  );
}
