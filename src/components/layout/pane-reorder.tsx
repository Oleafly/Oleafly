import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { trackPointerDrag } from "@oleafly/workspace/drag";
import { contains, nearestEdge, zoneAt, zoneRect, type Rect } from "@oleafly/workspace/geometry";
import { PANES, usePaneLayoutStore, type DropTarget, type PaneId } from "@/store/pane-layout";

const DROP_INSET_PX = 4;
const OUTER_EDGE_PX = 24;
const EDGE_SHARE = 0.25;
const OUTER_STRIP_SHARE = 0.25;
const PANE_IDS: readonly string[] = PANES;
const INTERACTIVE = [
  "button",
  "a[href]",
  "input",
  "textarea",
  "select",
  "label",
  "summary",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='button']",
  "[role='tab']",
  "[role='link']",
  "[role='menuitem']",
  "[role='checkbox']",
  "[role='switch']",
  "[role='radio']",
  "[role='slider']",
  "[role='combobox']",
  "[role='textbox']",
  "[role='option']",
  "[aria-haspopup]",
  "[data-state]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export const PANE_BAR_CLASS =
  "data-[pane-grab=true]:cursor-grab data-[pane-dragging=true]:bg-primary/10";

export interface PaneReorder {
  movable(pane: PaneId): boolean;
  begin(pane: PaneId, bar: HTMLElement, event: ReactPointerEvent<HTMLElement>): void;
}

const PaneReorderContext = createContext<PaneReorder | null>(null);

export function usePaneReorder(): PaneReorder | null {
  return useContext(PaneReorderContext);
}

export function paneOfElement(element: Element | null): PaneId | null {
  let panel = element?.closest("[data-panel]") ?? null;
  while (panel) {
    if (PANE_IDS.includes(panel.id)) return panel.id as PaneId;
    panel = panel.parentElement?.closest("[data-panel]") ?? null;
  }
  return null;
}

export function emptyBarTarget(target: EventTarget | null, bar: Element): boolean {
  if (!(target instanceof Element) || !bar.contains(target)) return false;
  const control = target.closest(INTERACTIVE);
  return control === null || control.contains(bar);
}

interface PaneDrop {
  pane: PaneId;
  target: DropTarget;
  box: Rect;
}

function inset(box: Rect): Rect {
  return {
    left: box.left + DROP_INSET_PX,
    top: box.top + DROP_INSET_PX,
    width: Math.max(0, box.width - 2 * DROP_INSET_PX),
    height: Math.max(0, box.height - 2 * DROP_INSET_PX),
  };
}

function paneRects(root: HTMLElement, dragged: PaneId): { pane: PaneId; rect: DOMRect }[] {
  return [...root.querySelectorAll<HTMLElement>("[data-panel]")]
    .filter((element) => PANE_IDS.includes(element.id) && element.id !== dragged)
    .map((element) => ({ pane: element.id as PaneId, rect: element.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width > 0 && rect.height > 0);
}

export function dropAt(root: HTMLElement, pane: PaneId, x: number, y: number): PaneDrop | null {
  const area = root.getBoundingClientRect();
  const [edge, edgeDistance] = nearestEdge(area, x, y, false);
  if (edgeDistance < 0) return null;
  if (edgeDistance <= OUTER_EDGE_PX) {
    return { pane, target: { kind: "edge", side: edge }, box: inset(zoneRect(area, edge, OUTER_STRIP_SHARE)) };
  }
  const hit = paneRects(root, pane).find(({ rect }) => contains(rect, x, y));
  if (!hit) return null;
  const side = zoneAt(hit.rect, x, y, EDGE_SHARE);
  if (side === "center") return null;
  return { pane, target: { kind: "pane", pane: hit.pane, side }, box: inset(zoneRect(hit.rect, side)) };
}

export function PaneReorderProvider({
  rootRef,
  visiblePanes,
  children,
}: Readonly<{
  rootRef: RefObject<HTMLElement | null>;
  visiblePanes: readonly PaneId[];
  children: ReactNode;
}>) {
  const cleanup = useRef<(() => void) | null>(null);
  const [drag, setDrag] = useState<{ drop: PaneDrop | null } | null>(null);

  useEffect(() => () => cleanup.current?.(), []);

  const visibleKey = visiblePanes.join("|");

  const reorder = useMemo<PaneReorder>(() => {
    const visible = visibleKey === "" ? [] : visibleKey.split("|");
    return {
      movable(pane) {
        return visible.length > 1 && visible.includes(pane);
      },
      begin(pane, bar, event) {
        const root = rootRef.current;
        if (!root) return;
        cleanup.current?.();
        event.preventDefault();
        let latest: PaneDrop | null = null;
        cleanup.current = trackPointerDrag(event, {
          start() {
            bar.dataset.paneDragging = "true";
          },
          move(point) {
            latest = dropAt(root, pane, point.clientX, point.clientY);
            setDrag({ drop: latest });
          },
          end(dropped) {
            delete bar.dataset.paneDragging;
            cleanup.current = null;
            setDrag(null);
            if (dropped && latest) usePaneLayoutStore.getState().move(pane, latest.target);
          },
        });
      },
    };
  }, [rootRef, visibleKey]);

  const drop = drag?.drop ?? null;

  return (
    <PaneReorderContext.Provider value={reorder}>
      {children}
      {drag &&
        createPortal(
          <div aria-hidden data-pane-reorder="dragging" className="fixed inset-0 z-50 cursor-grabbing select-none">
            {drop && (
              <div
                data-pane-drop={drop.target.kind === "edge" ? `edge-${drop.target.side}` : `${drop.target.pane}-${drop.target.side}`}
                className="pointer-events-none fixed rounded-md border border-primary/60 bg-primary/10 transition-[left,top,width,height] duration-100 motion-reduce:transition-none"
                style={drop.box}
              />
            )}
          </div>,
          document.body,
        )}
    </PaneReorderContext.Provider>
  );
}

export interface PaneBarProps {
  "data-pane-bar"?: "";
  onPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove?: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave?: (event: ReactPointerEvent<HTMLElement>) => void;
}

function setGrab(bar: HTMLElement, grab: boolean): void {
  if (grab) bar.dataset.paneGrab = "true";
  else delete bar.dataset.paneGrab;
}

export function usePaneBar(): PaneBarProps {
  const reorder = usePaneReorder();
  return useMemo<PaneBarProps>(() => {
    if (!reorder) return {};
    const grabbable = (event: ReactPointerEvent<HTMLElement>): PaneId | null => {
      if (document.fullscreenElement) return null;
      const pane = paneOfElement(event.currentTarget);
      if (pane === null || !reorder.movable(pane)) return null;
      return emptyBarTarget(event.target, event.currentTarget) ? pane : null;
    };
    return {
      "data-pane-bar": "",
      onPointerDown(event) {
        if (event.button !== 0 || event.defaultPrevented) return;
        const pane = grabbable(event);
        if (pane !== null) reorder.begin(pane, event.currentTarget, event);
      },
      onPointerMove(event) {
        setGrab(event.currentTarget, event.buttons === 0 && grabbable(event) !== null);
      },
      onPointerLeave(event) {
        setGrab(event.currentTarget, false);
      },
    };
  }, [reorder]);
}
