import { type ReactNode, type RefObject, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TOOLTIP_BUBBLE_CLASS } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const DELEGATED_TOOLTIP_ATTRIBUTE = "data-tooltip";
export const DELEGATED_TOOLTIP_SIDE_ATTRIBUTE = "data-tooltip-side";
const SHOW_DELAY_MS = 300;
const GAP = 6;
const MARGIN = 8;

type Tip = Readonly<{ target: HTMLElement; label: string }>;

function tooltipTarget(container: HTMLElement, node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null;
  const target = node.closest<HTMLElement>(`[${DELEGATED_TOOLTIP_ATTRIBUTE}]`);
  return target && container.contains(target) ? target : null;
}

function focusVisible(element: HTMLElement): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return false;
  }
}

export function useDelegatedTooltips(containerRef: RefObject<HTMLElement | null>): ReactNode {
  const [tip, setTip] = useState<Tip | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const attached = useRef<HTMLElement | null>(null);
  const detach = useRef<(() => void) | null>(null);
  const reactId = useId();
  const tipId = `oleafly-list-tooltip-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container === attached.current) return;
    detach.current?.();
    detach.current = null;
    attached.current = container;
    setTip(null);
    if (!container) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let hovered: HTMLElement | null = null;
    let focused: HTMLElement | null = null;
    const clear = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const show = (target: HTMLElement) => {
      const label = target.getAttribute(DELEGATED_TOOLTIP_ATTRIBUTE);
      if (!label) return;
      setTip((current) => (current?.target === target && current.label === label ? current : { target, label }));
    };
    const hide = () => {
      clear();
      setTip(null);
    };
    const onOver = (event: PointerEvent) => {
      const target = tooltipTarget(container, event.target);
      if (target === hovered) return;
      hovered = target;
      clear();
      if (!target) {
        if (!focused) setTip(null);
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        show(target);
      }, SHOW_DELAY_MS);
    };
    const onLeave = () => {
      hovered = null;
      if (!focused) hide();
    };
    const onPress = () => {
      hovered = null;
      focused = null;
      hide();
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = tooltipTarget(container, event.target);
      if (!target || !focusVisible(target)) return;
      focused = target;
      clear();
      show(target);
    };
    const onFocusOut = () => {
      focused = null;
      if (!hovered) hide();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    container.addEventListener("pointerover", onOver);
    container.addEventListener("pointerleave", onLeave);
    container.addEventListener("pointerdown", onPress, true);
    container.addEventListener("focusin", onFocusIn);
    container.addEventListener("focusout", onFocusOut);
    container.addEventListener("keydown", onKey, true);
    container.addEventListener("scroll", hide, { passive: true });
    detach.current = () => {
      clear();
      container.removeEventListener("pointerover", onOver);
      container.removeEventListener("pointerleave", onLeave);
      container.removeEventListener("pointerdown", onPress, true);
      container.removeEventListener("focusin", onFocusIn);
      container.removeEventListener("focusout", onFocusOut);
      container.removeEventListener("keydown", onKey, true);
      container.removeEventListener("scroll", hide);
    };
  });

  useLayoutEffect(
    () => () => {
      detach.current?.();
      detach.current = null;
      attached.current = null;
    },
    [],
  );

  useLayoutEffect(() => {
    setPosition(null);
    if (!tip) return;
    const { target } = tip;
    const id = tipId;
    const prior = target.getAttribute("aria-describedby");
    target.setAttribute("aria-describedby", prior ? `${prior} ${id}` : id);
    const trigger = target.getBoundingClientRect();
    const bubble = tipRef.current?.getBoundingClientRect();
    if (bubble && target.isConnected) {
      const right = target.getAttribute(DELEGATED_TOOLTIP_SIDE_ATTRIBUTE) === "right";
      const top = right
        ? trigger.top + trigger.height / 2 - bubble.height / 2
        : trigger.bottom + GAP;
      const left = right ? trigger.right + GAP : trigger.left + trigger.width / 2 - bubble.width / 2;
      setPosition({
        top: Math.max(MARGIN, Math.min(top, window.innerHeight - bubble.height - MARGIN)),
        left: Math.max(MARGIN, Math.min(left, window.innerWidth - bubble.width - MARGIN)),
      });
    }
    return () => {
      if (prior === null) target.removeAttribute("aria-describedby");
      else target.setAttribute("aria-describedby", prior);
    };
  }, [tip, tipId]);

  if (!tip || typeof document === "undefined") return null;
  return createPortal(
    <span
      ref={tipRef}
      id={tipId}
      role="tooltip"
      className={cn(
        TOOLTIP_BUBBLE_CLASS,
        "w-max max-w-[260px] whitespace-normal font-medium [overflow-wrap:anywhere]",
        !position && "opacity-0",
      )}
      style={position ?? { top: -9999, left: -9999 }}
    >
      {tip.label}
    </span>,
    document.body,
  );
}
