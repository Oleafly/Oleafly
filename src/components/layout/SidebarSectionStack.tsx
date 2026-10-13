import {
  createRef,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEventHandler,
  type ReactNode,
  type RefObject,
} from "react";
import {
  Group,
  Panel,
  Separator,
  type GroupImperativeHandle,
  type Layout,
  type PanelImperativeHandle,
} from "react-resizable-panels";
import {
  PANEL_STYLE,
  collapsePanel,
  expandPanel,
  panelLimitProps,
  percent,
  useCollapseTransitions,
  usePersistentPanelLayout,
  useSeparatorHitArea,
  useSeparatorKeyboard,
  type CollapseWatch,
  type PanelLimits,
} from "@/lib/panel-layout";
import { cn } from "@/lib/utils";

export interface StackSection {
  readonly id: string;
  readonly title: string;
  readonly handleId: string;
  readonly collapsed: boolean;
  readonly onCollapsedChange: (collapsed: boolean) => void;
  readonly render: (collapsed: boolean, toggle: (collapsed: boolean) => void) => ReactNode;
}

export function reclaimExplorerFillerLayout(
  layout: readonly number[],
  collapsedSize: number,
): number[] | null {
  const fillerIndex = layout.length - 1;
  const fillerSize = layout[fillerIndex] ?? 0;
  if (fillerSize < 0.1) return null;
  let receivingIndex = -1;
  for (let index = fillerIndex - 1; index >= 0; index -= 1) {
    if ((layout[index] ?? 0) > collapsedSize + 0.1) {
      receivingIndex = index;
      break;
    }
  }
  const receivingSize = layout[receivingIndex];
  if (receivingIndex < 0 || receivingSize === undefined) return null;

  const nextLayout = [...layout];
  nextLayout[receivingIndex] = receivingSize + fillerSize;
  nextLayout[fillerIndex] = 0;
  return nextLayout;
}

function defaultSizes(collapsed: readonly boolean[], collapsedSize: number): number[] {
  const closed = collapsed.filter(Boolean).length;
  const open = collapsed.length - closed;
  const rest = 100 - closed * collapsedSize;
  return collapsed.map((shut) => (shut ? collapsedSize : rest / Math.max(1, open)));
}

function SectionHandle({
  id,
  ariaLabel,
  onKeyDownCapture,
}: Readonly<{
  id: string;
  ariaLabel: string;
  onKeyDownCapture: KeyboardEventHandler<HTMLElement>;
}>) {
  return (
    <Separator
      id={id}
      disableDoubleClick
      aria-label={ariaLabel}
      onKeyDownCapture={onKeyDownCapture}
      style={{ cursor: "row-resize" }}
      className="resize-handle-row group relative z-10 -my-[5px] flex h-2.5 select-none items-center justify-center"
    >
      <span className="h-0.5 w-8 rounded-full bg-transparent opacity-0 transition-[background-color,opacity] group-hover:bg-ring group-hover:opacity-100 group-focus-visible:bg-ring group-focus-visible:opacity-100 group-data-[separator=active]:bg-ring group-data-[separator=active]:opacity-100" />
    </Separator>
  );
}

function SectionGroup({
  groupId,
  persist,
  fillerId,
  fillerHandleId,
  sections,
  collapsedSize,
  resizeLabel,
  onCollapsedSize,
  testId,
}: Readonly<{
  groupId: string;
  persist: boolean;
  fillerId: string;
  fillerHandleId: string;
  sections: readonly StackSection[];
  collapsedSize: number;
  resizeLabel: (first: string, second: string) => string;
  onCollapsedSize: (size: number) => void;
  testId: string;
}>) {
  const ids = useMemo(() => sections.map((section) => section.id), [sections]);
  const panelIds = useMemo(() => [...ids, fillerId], [ids, fillerId]);
  const stackRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<GroupImperativeHandle>(null);
  const fillerRef = useRef<PanelImperativeHandle>(null);
  const panelRefs = useRef(new Map<string, RefObject<PanelImperativeHandle | null>>());
  const fillerResetTimer = useRef<number | null>(null);
  const collapsedSizeRef = useRef(collapsedSize);
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;
  const [initialCollapsed] = useState(() => sections.map((section) => section.collapsed));
  const { defaultLayout, onLayoutChanged } = usePersistentPanelLayout(
    persist ? groupId : undefined,
    panelIds,
    panelIds,
  );
  const trackCollapse = useCollapseTransitions();
  const hitArea = useSeparatorHitArea(0);

  const panelRef = useCallback((id: string) => {
    let ref = panelRefs.current.get(id);
    if (!ref) {
      ref = createRef<PanelImperativeHandle>();
      panelRefs.current.set(id, ref);
    }
    return ref;
  }, []);

  const reclaimFiller = useCallback(() => {
    if (!stackRef.current?.isConnected) return;
    const group = groupRef.current;
    if (!group) return;
    const layout = group.getLayout();
    const sizes = panelIds.map((id) => layout[id]);
    if (!sizes.every((size): size is number => size !== undefined)) return;
    const nextLayout = reclaimExplorerFillerLayout(sizes, collapsedSizeRef.current);
    if (nextLayout) {
      group.setLayout(Object.fromEntries(panelIds.map((id, index) => [id, nextLayout[index] ?? 0])));
    }
  }, [panelIds]);

  const scheduleFillerReclaim = useCallback(() => {
    if (fillerResetTimer.current !== null) return;
    fillerResetTimer.current = window.setTimeout(() => {
      fillerResetTimer.current = null;
      reclaimFiller();
    }, 0);
  }, [reclaimFiller]);

  useEffect(() => {
    const stack = stackRef.current;
    if (!stack) return;
    const measure = () => {
      const style = window.getComputedStyle(stack);
      const height =
        stack.getBoundingClientRect().height -
        (Number.parseFloat(style.paddingTop) || 0) -
        (Number.parseFloat(style.paddingBottom) || 0);
      if (height <= 0) return;
      onCollapsedSize(Math.max(1.5, Math.min(28, (33 / height) * 100)));
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(stack);
    return () => observer.disconnect();
  }, [onCollapsedSize]);

  useEffect(
    () => () => {
      if (fillerResetTimer.current !== null) {
        window.clearTimeout(fillerResetTimer.current);
        fillerResetTimer.current = null;
      }
    },
    [],
  );

  const collapsedKey = sections.map((section) => (section.collapsed ? "1" : "0")).join("");
  useEffect(() => {
    collapsedSizeRef.current = collapsedSize;
    if (!collapsedKey.includes("0")) return;
    scheduleFillerReclaim();
  }, [collapsedSize, collapsedKey, scheduleFillerReclaim]);

  const minExpandedSize = Math.max(16, Math.min(32, collapsedSize + 4));
  const limits = useMemo(() => {
    const section: PanelLimits = { minSize: minExpandedSize, collapsible: true, collapsedSize };
    return {
      ...Object.fromEntries(ids.map((id) => [id, section])),
      [fillerId]: { minSize: 0 },
    } satisfies Record<string, PanelLimits>;
  }, [collapsedSize, fillerId, ids, minExpandedSize]);
  const onSeparatorKeyDown = useSeparatorKeyboard(groupRef, limits);

  const expand = useCallback(
    (index: number) => {
      const section = sectionsRef.current[index];
      const panel = section ? panelRef(section.id).current : null;
      if (!section || !panel?.isCollapsed()) return;
      const reserve = fillerRef.current;
      const canGrowForward = sectionsRef.current
        .slice(index + 1)
        .some((next) => panelRef(next.id).current?.isCollapsed() === false);
      if (!canGrowForward && reserve && reserve.getSize().asPercentage < minExpandedSize) {
        reserve.resize(percent(minExpandedSize));
      }
      expandPanel(groupId, section.id, panel, minExpandedSize);
    },
    [groupId, minExpandedSize, panelRef],
  );

  const changeRef = useRef<(next: boolean, id: string) => void>(() => undefined);
  changeRef.current = (next, id) => {
    const index = sectionsRef.current.findIndex((section) => section.id === id);
    const section = sectionsRef.current[index];
    if (!section) return;
    section.onCollapsedChange(next);
    const panel = panelRef(id).current;
    if (!panel) return;
    if (next) collapsePanel(groupId, id, panel);
    else expand(index);
  };

  const toggles = useRef(new Map<string, (collapsed: boolean) => void>());
  const toggleFor = (id: string) => {
    let toggle = toggles.current.get(id);
    if (!toggle) {
      toggle = (next: boolean) => changeRef.current(next, id);
      toggles.current.set(id, toggle);
    }
    return toggle;
  };

  const shown = useRef(new Map(sections.map((section) => [section.id, section.collapsed])));
  useEffect(() => {
    sections.forEach((section, index) => {
      const before = shown.current.get(section.id);
      shown.current.set(section.id, section.collapsed);
      if (before === undefined || before === section.collapsed) return;
      const panel = panelRef(section.id).current;
      if (!panel) return;
      if (section.collapsed && !panel.isCollapsed()) collapsePanel(groupId, section.id, panel);
      else if (!section.collapsed) expand(index);
    });
  }, [expand, groupId, panelRef, sections]);

  const onLayoutChange = (layout: Layout) => {
    const watches: Record<string, CollapseWatch> = {};
    for (const section of sectionsRef.current) {
      watches[section.id] = {
        collapsedSize,
        onCollapse: () => section.onCollapsedChange(true),
        onExpand: () => section.onCollapsedChange(false),
      };
    }
    trackCollapse(layout, watches);
    if ((layout[fillerId] ?? 0) >= 0.1) scheduleFillerReclaim();
  };

  const sizes = defaultSizes(initialCollapsed, collapsedSize);
  const last = sections[sections.length - 1];

  return (
    <div ref={stackRef} data-testid={testId} className={cn("h-full min-h-0", last?.collapsed && "pb-2.5")}>
      <Group
        groupRef={groupRef}
        orientation="vertical"
        defaultLayout={defaultLayout}
        onLayoutChange={onLayoutChange}
        onLayoutChanged={onLayoutChanged}
        resizeTargetMinimumSize={hitArea}
        className="h-full min-h-0"
      >
        {sections.map((section, index) => {
          const before = sections[index - 1];
          return (
            <Fragment key={section.id}>
              {before ? (
                <SectionHandle
                  id={section.handleId}
                  ariaLabel={resizeLabel(before.title, section.title)}
                  onKeyDownCapture={onSeparatorKeyDown}
                />
              ) : null}
              <Panel
                panelRef={panelRef(section.id)}
                id={section.id}
                defaultSize={percent(sizes[index] ?? collapsedSize)}
                {...panelLimitProps(limits[section.id] ?? {})}
                style={PANEL_STYLE}
              >
                {section.render(section.collapsed, toggleFor(section.id))}
              </Panel>
            </Fragment>
          );
        })}
        <Separator
          id={fillerHandleId}
          disabled
          disableDoubleClick
          aria-hidden="true"
          className="invisible h-0 overflow-hidden"
        />
        <Panel
          panelRef={fillerRef}
          id={fillerId}
          defaultSize={percent(initialCollapsed.every(Boolean) ? 100 - sections.length * collapsedSize : 0)}
          {...panelLimitProps(limits[fillerId])}
          aria-hidden="true"
          style={PANEL_STYLE}
          className="pointer-events-none"
        >
          <span />
        </Panel>
      </Group>
    </div>
  );
}

export function SidebarSectionStack({
  groupId,
  persist = true,
  fillerId,
  fillerHandleId,
  sections,
  resizeLabel,
  testId,
}: Readonly<{
  groupId: string;
  persist?: boolean;
  fillerId: string;
  fillerHandleId: string;
  sections: readonly StackSection[];
  resizeLabel: (first: string, second: string) => string;
  testId: string;
}>) {
  const [collapsedSize, setCollapsedSize] = useState(6);
  const onCollapsedSize = useCallback((next: number) => {
    setCollapsedSize((current) => (Math.abs(current - next) < 0.05 ? current : next));
  }, []);
  return (
    <SectionGroup
      key={sections.map((section) => section.id).join("|")}
      groupId={groupId}
      persist={persist}
      fillerId={fillerId}
      fillerHandleId={fillerHandleId}
      sections={sections}
      collapsedSize={collapsedSize}
      resizeLabel={resizeLabel}
      onCollapsedSize={onCollapsedSize}
      testId={testId}
    />
  );
}
