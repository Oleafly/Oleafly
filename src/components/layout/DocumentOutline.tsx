import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronRight,
  CopyMinus,
  CopyPlus,
  FileText,
  List,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  collectLatexOutlineMacros,
  renderLatexOutlineTitle,
} from "@oleafly/latex";
import { useEditorViewportAnchor } from "@/components/editor/cm/use-viewport-anchor";
import { Button } from "@/components/ui/button";
import { PanelState } from "@/components/layout/IntelligenceTree";
import { SidebarSection } from "@/components/layout/SidebarSection";
import { outlineFromIndex, type OutlineItem } from "@/lib/index/outline";
import { activeOutlineIndex } from "@/lib/outline-active";
import { navigateToProjectRange } from "@/lib/project-intelligence/navigation";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import { cn } from "@/lib/utils";

function basename(path: string): string {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(index + 1) : path;
}

function normalizedHeadingTitle(title: string): string {
  return title.replace(/\s+/gu, " ").trim().toLowerCase();
}

function headingIds(items: readonly OutlineItem[]): string[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const key = `${item.file}:${item.level}:${normalizedHeadingTitle(item.title)}`;
    const ordinal = seen.get(key) ?? 0;
    seen.set(key, ordinal + 1);
    return `${key}:${ordinal}`;
  });
}

type VisibleHeading = Readonly<{
  item: OutlineItem;
  itemIndex: number;
  id: string;
  hasDescendants: boolean;
}>;

function visibleHeadings(
  items: readonly OutlineItem[],
  ids: readonly string[],
  collapsedHeadingIds: ReadonlySet<string>,
): VisibleHeading[] {
  const ancestors: Array<{ level: number; id: string }> = [];
  const visible: VisibleHeading[] = [];

  items.forEach((item, index) => {
    while (true) {
      const ancestor = ancestors.at(-1);
      if (!ancestor || ancestor.level < item.level) break;
      ancestors.pop();
    }

    const id = ids[index] ?? "";

    // A collapsed ancestor hides every deeper heading, while peers and the
    // next top-level heading remain visible. Keep walking hidden branches so
    // their descendants still regain the correct parent when re-expanded.
    if (ancestors.every((ancestor) => !collapsedHeadingIds.has(ancestor.id))) {
      visible.push({
        item,
        itemIndex: index,
        id,
        hasDescendants: (items[index + 1]?.level ?? item.level) > item.level,
      });
    }

    ancestors.push({ level: item.level, id });
  });

  return visible;
}

// The section list for the document you are actually editing, following
// \input and \include so a split thesis reads as one outline.
//
// This is deliberately not the same thing as Structure below it. Structure
// answers "what is in this project" - every file, label, citation key and
// dependency, addressed by file:line. Outline answers "where am I in this
// document", which is the question you have while writing, and it needs to
// stay quiet enough to scan in one glance.
//
// Derived entirely from the shared project index, so it stays in step with
// everything else that reads the index and does no parsing or file IO here.
export function DocumentOutline({
  collapsed: controlledCollapsed,
  onCollapsedChange,
}: {
  readonly collapsed?: boolean;
  readonly onCollapsedChange?: (next: boolean) => void;
} = {}) {
  const { t } = useTranslation(["workspace"]);
  const index = useIndexStore((state) => state.index);
  const texts = useIndexStore((state) => state.texts);
  const building = useIndexStore((state) => state.building);
  const projectId = useFilesStore((state) => state.projectId);
  const activePath = useFilesStore((state) => state.activePath);
  const [uncontrolledCollapsed, setUncontrolledCollapsed] = useState(false);
  const evaluatedDocumentKey = useRef<string | null>(null);
  const autoCollapsedDocumentKey = useRef<string | null>(null);
  const [collapsedHeadingIds, setCollapsedHeadingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const collapsed = controlledCollapsed ?? uncontrolledCollapsed;
  const setOpen = (open: boolean) => {
    const next = !open;
    autoCollapsedDocumentKey.current = null;
    setUncontrolledCollapsed(next);
    onCollapsedChange?.(next);
  };

  const items = useMemo(
    () =>
      index && activePath
        ? outlineFromIndex(index, activePath).filter(
            // Sections only. An \input whose target has no headings of its own
            // contributed a bare filename row, which is file-tree information,
            // not an outline.
            (item) => item.kind === "section",
          )
        : [],
    [index, activePath],
  );
  const itemIds = useMemo(() => headingIds(items), [items]);
  const collapsibleHeadingIds = useMemo(() => {
    const collapsible = new Set<string>();
    items.forEach((item, index) => {
      if ((items[index + 1]?.level ?? item.level) > item.level) {
        collapsible.add(itemIds[index] ?? "");
      }
    });
    return collapsible;
  }, [itemIds, items]);
  const resolvedDocumentKey =
    !building && index && activePath
      ? `${projectId ?? ""}:${activePath}`
      : null;

  // An empty outline should stay out of the way on first load. This runs once
  // per resolved document, so a reader can still open the empty section by
  // hand without it immediately closing again. If that automatic collapse is
  // followed by a document that has headings, restore the normal open default.
  useEffect(() => {
    if (!resolvedDocumentKey) return;

    const isNewDocument = evaluatedDocumentKey.current !== resolvedDocumentKey;
    if (isNewDocument) {
      evaluatedDocumentKey.current = resolvedDocumentKey;
      if (items.length === 0) {
        if (!collapsed) {
          autoCollapsedDocumentKey.current = resolvedDocumentKey;
          setUncontrolledCollapsed(true);
          onCollapsedChange?.(true);
        } else if (autoCollapsedDocumentKey.current !== null) {
          // Keep ownership of an automatic collapse while the reader moves
          // through empty documents. That way the first heading in the current
          // document restores the normal open default; a manual collapse has
          // already cleared this marker in setOpen.
          autoCollapsedDocumentKey.current = resolvedDocumentKey;
        }
        return;
      }
    } else if (autoCollapsedDocumentKey.current !== resolvedDocumentKey) {
      return;
    }

    // A controlled owner can open the section through its resize handle,
    // bypassing setOpen. Treat that as a manual choice instead of immediately
    // applying the empty-document default again.
    if (items.length === 0) {
      if (!collapsed) autoCollapsedDocumentKey.current = null;
      return;
    }

    if (autoCollapsedDocumentKey.current !== null) {
      autoCollapsedDocumentKey.current = null;
      if (collapsed) {
        setUncontrolledCollapsed(false);
        onCollapsedChange?.(false);
      }
    }
  }, [collapsed, items.length, onCollapsedChange, resolvedDocumentKey]);
  const headings = useMemo(
    () => visibleHeadings(items, itemIds, collapsedHeadingIds),
    [collapsedHeadingIds, itemIds, items],
  );
  const previousProjectId = useRef(projectId);

  // Indexing can replace the current document while the panel stays mounted.
  // Discard IDs no longer present so a stale branch cannot affect a later
  // document that happens to contain a similarly shaped outline.
  useEffect(() => {
    if (previousProjectId.current !== projectId) {
      previousProjectId.current = projectId;
      setCollapsedHeadingIds(new Set());
      return;
    }
    setCollapsedHeadingIds((current) => {
      const next = new Set(
        [...current].filter((id) => collapsibleHeadingIds.has(id)),
      );
      return next.size === current.size ? current : next;
    });
  }, [collapsibleHeadingIds, projectId]);

  const anchor = useEditorViewportAnchor();
  const activeIndex = useMemo(
    () => activeOutlineIndex(items, anchor),
    [items, anchor],
  );
  const activeHeadingVisible = useMemo(() => {
    const activeId = activeIndex >= 0 ? itemIds[activeIndex] : undefined;
    return activeId
      ? headings.some((heading) => heading.id === activeId)
      : false;
  }, [activeIndex, headings, itemIds]);
  const latexMacros = useMemo(
    () => collectLatexOutlineMacros(texts),
    [texts],
  );

  const activeRef = useRef<HTMLButtonElement | null>(null);
  // A long outline scrolls itself to follow the editor, but never while the
  // pointer is over the panel: yanking the list out from under a reader who is
  // about to click a different section is worse than losing the highlight.
  const hoveringRef = useRef(false);
  useEffect(() => {
    if (
      collapsed ||
      activeIndex < 0 ||
      !activeHeadingVisible ||
      hoveringRef.current
    )
      return;
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeHeadingVisible, activeIndex, collapsed]);

  const jump = useCallback((item: OutlineItem) => {
    // Goes through the shared navigation path, which opens the file, reveals
    // the editor and selects the range as one operation. The original outline
    // opened the file and then guessed at an 80ms delay before jumping, which
    // lost the jump whenever the open took longer.
    void navigateToProjectRange({
      path: item.file,
      range: { from: item.from, to: item.to },
      source: "outline",
    });
  }, []);

  const toggleHeading = useCallback((id: string) => {
    setCollapsedHeadingIds((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);
  const collapseAllHeadings = useCallback(() => {
    setCollapsedHeadingIds(new Set(collapsibleHeadingIds));
  }, [collapsibleHeadingIds]);
  const expandAllHeadings = useCallback(() => {
    setCollapsedHeadingIds(new Set());
  }, []);
  const hasCollapsibleHeadings = collapsibleHeadingIds.size > 0;
  const allHeadingsCollapsed =
    hasCollapsibleHeadings &&
    [...collapsibleHeadingIds].every((id) => collapsedHeadingIds.has(id));
  return (
    <SidebarSection
      id="document-outline"
      title={t(($) => $.workspace.outline.title)}
      icon={<List aria-hidden className="size-3.5" />}
      ariaLabel={t(($) => $.workspace.outline.ariaLabel)}
      count={items.length || undefined}
      countLabel={
        items.length
          ? t(($) => $.workspace.outline.entryCount, { count: items.length })
          : undefined
      }
      open={!collapsed}
      onOpenChange={setOpen}
      className={collapsed ? "shrink-0" : "h-full flex-1"}
      contentClassName="flex min-h-0 flex-1 flex-col pb-0"
      actions={
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label={t(
            allHeadingsCollapsed
              ? ($) => $.workspace.outline.expandAll
              : ($) => $.workspace.outline.collapseAll,
          )}
          title={t(
            allHeadingsCollapsed
              ? ($) => $.workspace.outline.expandAll
              : ($) => $.workspace.outline.collapseAll,
          )}
          disabled={!hasCollapsibleHeadings}
          onClick={
            allHeadingsCollapsed ? expandAllHeadings : collapseAllHeadings
          }
        >
          {allHeadingsCollapsed ? (
            <CopyPlus aria-hidden className="size-3.5" />
          ) : (
            <CopyMinus aria-hidden className="size-3.5" />
          )}
        </Button>
      }
    >
        {items.length === 0 ? (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <PanelState
              state="empty"
              title={t(($) => $.workspace.outline.empty)}
              detail={t(($) => $.workspace.outline.emptyDetail)}
            />
          </div>
        ) : (
        <div
          className="min-h-0 flex-1 overflow-auto py-1 [scrollbar-width:thin]"
          onPointerEnter={() => {
            hoveringRef.current = true;
          }}
          onPointerLeave={() => {
            hoveringRef.current = false;
          }}
        >
          {headings.map(({ item, itemIndex, id, hasDescendants }) => {
              const crossFile = item.file !== activePath;
              const active = itemIndex === activeIndex;
              const headingCollapsed = collapsedHeadingIds.has(id);
              const displayTitle = /\.(?:latex|ltx|tex)$/iu.test(item.file)
                ? renderLatexOutlineTitle(item.title, latexMacros)
                : item.title;
              return (
                <div
                  key={`${item.file}:${item.line}:${item.kind}:${item.title}`}
                  // Indent by heading depth so the shape of the document is
                  // visible without reading any of the titles. The active
                  // marker takes 2px off the left padding so the accent bar
                  // does not shift the title it marks.
                  style={{ paddingLeft: `${item.level * 12 + 12 - (active ? 2 : 0)}px` }}
                  className={cn(
                    "group flex min-h-7 w-full items-center gap-1 py-1 pr-2 text-[13px] leading-5 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                    active
                      ? "border-l-2 border-primary bg-sidebar-accent/60 font-medium text-sidebar-foreground"
                      : "text-sidebar-foreground/80",
                  )}
                >
                  {hasDescendants ? (
                    <button
                      type="button"
                      aria-label={t(
                        headingCollapsed
                          ? ($) => $.workspace.outline.expandHeading
                          : ($) => $.workspace.outline.collapseHeading,
                        { title: displayTitle },
                      )}
                      aria-expanded={!headingCollapsed}
                      onClick={() => toggleHeading(id)}
                      className="flex size-3.5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      {headingCollapsed ? (
                        <ChevronRight aria-hidden className="size-3" />
                      ) : (
                        <ChevronDown aria-hidden className="size-3" />
                      )}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    ref={active ? activeRef : undefined}
                    onClick={() => jump(item)}
                    aria-current={active ? "location" : undefined}
                    className="min-w-0 flex-1 truncate text-left text-[13px] leading-5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    title={`${displayTitle} — ${item.file}:${item.line}`}
                  >
                    <span
                      className={cn(
                        "truncate",
                        item.kind === "file" && "text-muted-foreground",
                      )}
                    >
                      {item.kind === "file" ? (
                        <FileText
                          aria-hidden
                          className="mr-1 inline-block size-3 shrink-0 text-muted-foreground"
                        />
                      ) : null}
                      {displayTitle}
                    </span>
                  </button>
                  {crossFile ? (
                    <span className="ml-auto shrink-0 rounded bg-muted px-1 font-mono text-[9px] text-muted-foreground/70">
                      {basename(item.file).replace(/\.[^.]+$/, "")}
                    </span>
                  ) : null}
                </div>
              );
            })}
        </div>
        )}
    </SidebarSection>
  );
}
