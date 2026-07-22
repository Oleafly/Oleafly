import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

type Side = "top" | "bottom" | "left" | "right";

// Portal to <body> and clamped to the viewport, so it's never clipped by
// ancestor `overflow` or the window edges. Replaces native `title`.
export function Tooltip({
  label,
  children,
  side = "bottom",
  delay = 300,
  className,
  wide = false,
}: {
  label: ReactNode;
  children: ReactNode;
  side?: Side;
  delay?: number;
  className?: string;
  wide?: boolean;
}) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const enter = () => {
    timer.current = setTimeout(() => setShow(true), delay);
  };
  const leave = () => {
    if (timer.current) clearTimeout(timer.current);
    setShow(false);
  };

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
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [show, side, label]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover is supplementary; the wrapped control remains keyboard accessible
    <span
      ref={triggerRef}
      className={cn("relative inline-flex", className)}
      onMouseEnter={enter}
      onMouseLeave={leave}
    >
      {children}
      {show &&
        createPortal(
          <span
            ref={tipRef}
            role="tooltip"
            className={cn(
              "pointer-events-none fixed z-[200] rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md",
              wide
                ? "max-w-xs whitespace-normal font-normal leading-relaxed"
                : "w-max max-w-[260px] whitespace-normal font-medium",
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
