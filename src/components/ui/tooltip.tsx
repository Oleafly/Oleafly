import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

type Side = "top" | "bottom" | "left" | "right";

const FOCUSABLE_TRIGGER = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

let keyboardModality = false;
let inputTrackingBound = false;

function trackInputModality() {
  if (inputTrackingBound || typeof document === "undefined") return;
  inputTrackingBound = true;
  const pointer = () => {
    keyboardModality = false;
  };
  const keyboard = () => {
    keyboardModality = true;
  };
  document.addEventListener("pointerdown", pointer, true);
  document.addEventListener("mousedown", pointer, true);
  document.addEventListener("touchstart", pointer, true);
  document.addEventListener("keydown", keyboard, true);
}

let focusVisibleSupported: boolean | null = null;

function supportsFocusVisible() {
  if (focusVisibleSupported === null) {
    try {
      focusVisibleSupported =
        typeof CSS !== "undefined" &&
        typeof CSS.supports === "function" &&
        CSS.supports("selector(:focus-visible)");
    } catch {
      focusVisibleSupported = false;
    }
  }
  return focusVisibleSupported;
}

function focusIsVisible(el: Element) {
  if (supportsFocusVisible()) {
    try {
      return el.matches(":focus-visible");
    } catch {
      return keyboardModality;
    }
  }
  return keyboardModality;
}

// Portal to <body> and clamped to the viewport, so it's never clipped by
// ancestor `overflow` or the window edges. Replaces native `title`.
export function Tooltip({
  label,
  children,
  side = "bottom",
  delay = 300,
  className,
  wide = false,
  role,
  suppressed = false,
}: {
  label: ReactNode;
  children: ReactNode;
  side?: Side;
  delay?: number;
  className?: string;
  wide?: boolean;
  /**
   * Holds the tooltip closed while an overlay owned by the same trigger is
   * open, so it cannot sit on top of that overlay.
   */
  suppressed?: boolean;
  /**
   * Role for the wrapper. Pass "none" where the extra element would otherwise
   * break a required parent/child relationship, such as tree → treeitem.
   */
  role?: "none";
}) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const focusedTrigger = useRef<HTMLElement | null>(null);
  const hovering = useRef(false);
  const focused = useRef(false);
  const reactId = useId();
  const tipId = `oleafly-tooltip-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  useEffect(() => {
    trackInputModality();
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const close = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setShow(false);
  }, []);

  const open = useCallback((wait: number) => {
    if (timer.current) clearTimeout(timer.current);
    if (wait <= 0) {
      setShow(true);
      return;
    }
    timer.current = setTimeout(() => setShow(true), wait);
  }, []);

  const enter = () => {
    if (suppressed) return;
    hovering.current = true;
    open(delay);
  };

  const leave = () => {
    hovering.current = false;
    if (timer.current) clearTimeout(timer.current);
    if (!focused.current) close();
  };

  const press = () => {
    hovering.current = false;
    focused.current = false;
    focusedTrigger.current = null;
    close();
  };

  useEffect(() => {
    if (suppressed) close();
  }, [suppressed, close]);

  const activate = (event: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (event.key === "Enter" || event.key === " ") press();
  };

  const handleFocus = (event: ReactFocusEvent<HTMLSpanElement>) => {
    if (!event.currentTarget.contains(event.target as Node)) return;
    const target = event.target as HTMLElement;
    if (!focusIsVisible(target)) return;
    focused.current = true;
    focusedTrigger.current = target;
    open(0);
  };

  const handleBlur = (event: ReactFocusEvent<HTMLSpanElement>) => {
    if (!event.currentTarget.contains(event.target as Node)) return;
    focused.current = false;
    focusedTrigger.current = null;
    if (!hovering.current) close();
  };

  useEffect(() => {
    if (!show) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [show, close]);

  useEffect(() => {
    if (!show) return;
    const host = triggerRef.current;
    if (!host) return;
    const active = focusedTrigger.current;
    const target =
      active && host.contains(active)
        ? active
        : (host.querySelector<HTMLElement>(FOCUSABLE_TRIGGER) ?? host);
    const prior = target.getAttribute("aria-describedby");
    target.setAttribute("aria-describedby", prior ? `${prior} ${tipId}` : tipId);
    return () => {
      if (prior === null) target.removeAttribute("aria-describedby");
      else target.setAttribute("aria-describedby", prior);
    };
  }, [show, tipId]);

  useLayoutEffect(() => {
    if (!show) return;
    void label;
    const place = () => {
      const trig = triggerRef.current?.getBoundingClientRect();
      const tip = tipRef.current?.getBoundingClientRect();
      if (!trig || !tip) return;
      const margin = 8;
      let top: number;
      let left: number;
      if (side === "bottom") top = trig.bottom + 6;
      else if (side === "top") top = trig.top - tip.height - 6;
      else top = trig.top + trig.height / 2 - tip.height / 2;

      if (side === "right") left = trig.right + 6;
      else if (side === "left") left = trig.left - tip.width - 6;
      else left = trig.left + trig.width / 2 - tip.width / 2;

      top = Math.max(margin, Math.min(top, window.innerHeight - tip.height - margin));
      left = Math.max(margin, Math.min(left, window.innerWidth - tip.width - margin));
      setPos({ top, left });
    };
    place();
    const frame =
      typeof requestAnimationFrame === "function" ? requestAnimationFrame(place) : null;
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [show, side, label]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover is supplementary; the wrapped control remains keyboard accessible
    <span
      ref={triggerRef}
      role={role}
      className={cn("relative inline-flex", className)}
      onMouseEnter={enter}
      onMouseLeave={leave}
      onMouseDown={press}
      onClick={press}
      onKeyDown={activate}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      {children}
      {show &&
        createPortal(
          <span
            ref={tipRef}
            id={tipId}
            role="tooltip"
            className={cn(
              "pointer-events-none fixed z-[200] rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md",
              // overflow-wrap anywhere: labels can carry long unbroken paths
              // (TeX bin directories), which must wrap instead of spilling
              // past the bubble.
              wide
                ? "max-w-xs whitespace-normal font-normal leading-relaxed [overflow-wrap:anywhere]"
                : "w-max max-w-[260px] whitespace-normal font-medium [overflow-wrap:anywhere]",
              !pos && "opacity-0"
            )}
            style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
          >
            {label}
          </span>,
          document.body
        )}
    </span>
  );
}
