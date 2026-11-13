import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { moveSection } from "./section-order";
import { trackReorderDrag } from "./reorder-drag";

export { DRAG_THRESHOLD_PX, swallowNextClick } from "./reorder-drag";

export interface SectionReorder {
  readonly dragging: string | null;
  begin(id: string, event: ReactPointerEvent<HTMLElement>): void;
  step(id: string, delta: number, element: HTMLElement): void;
}

const SectionReorderContext = createContext<SectionReorder | null>(null);

export function useSectionReorder(): SectionReorder | null {
  return useContext(SectionReorderContext);
}

interface Drop {
  id: string;
  index: number;
  self: boolean;
  top: number;
  height: number;
}

interface Region {
  stackId: string;
  rect: DOMRect;
}

function stackIdOf(element: Element, id: string, ids: readonly string[]): string | null {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.id && ids.includes(node.id)) return node.id;
  }
  return ids.includes(id) ? id : null;
}

function regionOf(header: HTMLElement, ids: readonly string[]): Region | null {
  const stackId = stackIdOf(header, header.dataset.sectionHeader ?? "", ids);
  if (stackId === null) return null;
  const element = header.closest(`[id="${CSS.escape(stackId)}"]`) ?? header.closest("section") ?? header;
  return { stackId, rect: element.getBoundingClientRect() };
}

function dropAt(root: HTMLElement, id: string, stackId: string, ids: readonly string[], y: number): Drop {
  const regions = [...root.querySelectorAll<HTMLElement>("[data-section-header]")]
    .map((header) => regionOf(header, ids))
    .filter((region): region is Region => region !== null);
  const target = regions.find((region) => y < region.rect.bottom) ?? regions.at(-1);
  if (!target) return { id, index: ids.indexOf(stackId), self: true, top: 0, height: 0 };
  const area = root.getBoundingClientRect();
  const top = Math.max(target.rect.top, area.top);
  const bottom = Math.min(target.rect.bottom, area.bottom);
  return {
    id,
    index: ids.indexOf(target.stackId),
    self: target.stackId === stackId,
    top: top - area.top,
    height: Math.max(0, bottom - top),
  };
}

export function SectionReorderArea({
  ids,
  onReorder,
  children,
}: Readonly<{ ids: readonly string[]; onReorder?: (ids: string[]) => void; children: ReactNode }>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;
  const refocus = useRef<string | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);

  useEffect(() => {
    const id = refocus.current;
    if (id === null) return;
    const button = rootRef.current?.querySelector<HTMLElement>(`[data-section-header="${CSS.escape(id)}"] button`);
    if (!button) return;
    refocus.current = null;
    if (button !== document.activeElement) button.focus();
  });

  useEffect(() => () => cleanup.current?.(), []);

  const reorder = useMemo<SectionReorder | null>(() => {
    if (!onReorder) return null;
    return {
      dragging: drop?.id ?? null,
      step(id, delta, element) {
        const current = idsRef.current;
        const stackId = stackIdOf(element, id, current);
        if (stackId === null) return;
        const from = current.indexOf(stackId);
        const to = from + delta;
        if (to < 0 || to >= current.length) return;
        refocus.current = id;
        onReorderRef.current?.(moveSection(current, stackId, to));
      },
      begin(id, event) {
        const root = rootRef.current;
        if (event.button !== 0 || !root) return;
        const stackId = stackIdOf(event.currentTarget, id, idsRef.current);
        if (stackId === null) return;
        cleanup.current?.();
        cleanup.current = trackReorderDrag<Drop>(event, {
          axis: "y",
          locate: (y) => dropAt(root, id, stackId, idsRef.current, y),
          show: setDrop,
          land: (landed) => {
            if (landed.self) return;
            const next = moveSection(idsRef.current, stackId, landed.index);
            if (next.join("|") !== idsRef.current.join("|")) onReorderRef.current?.(next);
          },
        });
      },
    };
  }, [drop?.id, onReorder]);

  return (
    <SectionReorderContext.Provider value={reorder}>
      <div ref={rootRef} data-section-reorder={drop ? "dragging" : undefined} className="relative h-full min-h-0">
        {children}
        {drop && !drop.self && (
          <div
            aria-hidden
            data-section-drop={drop.index}
            className="pointer-events-none absolute inset-x-1 z-30 rounded-md border border-primary/60 bg-primary/10 transition-[top,height] duration-100 motion-reduce:transition-none"
            style={{ top: drop.top, height: drop.height }}
          />
        )}
      </div>
    </SectionReorderContext.Provider>
  );
}
