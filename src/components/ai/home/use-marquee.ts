import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { marqueeStep, type MarqueeDirection } from "./marquee";

const PIXELS_PER_SECOND = 16;
const RESUME_AFTER_INPUT_MS = 2_000;

export function useMarquee(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  const [held, setHeld] = useState(false);
  const resumeTimer = useRef<number | null>(null);

  const release = useCallback(() => {
    if (resumeTimer.current !== null) window.clearTimeout(resumeTimer.current);
    resumeTimer.current = null;
    setHeld(false);
  }, []);

  const hold = useCallback(() => {
    if (resumeTimer.current !== null) window.clearTimeout(resumeTimer.current);
    resumeTimer.current = null;
    setHeld(true);
  }, []);

  const holdBriefly = useCallback(() => {
    setHeld(true);
    if (resumeTimer.current !== null) window.clearTimeout(resumeTimer.current);
    resumeTimer.current = window.setTimeout(() => {
      resumeTimer.current = null;
      setHeld(false);
    }, RESUME_AFTER_INPUT_MS);
  }, []);

  useEffect(
    () => () => {
      if (resumeTimer.current !== null) window.clearTimeout(resumeTimer.current);
    },
    [],
  );

  useEffect(() => {
    const node = ref.current;
    if (!node || !enabled || held) return;
    if (typeof requestAnimationFrame !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let direction: MarqueeDirection = 1;
    let previous: number | null = null;
    let position = node.scrollLeft;
    let written = node.scrollLeft;
    let frame = requestAnimationFrame(function tick(time: number) {
      if (previous !== null) {
        if (Math.abs(node.scrollLeft - written) > 1) position = node.scrollLeft;
        const max = node.scrollWidth - node.clientWidth;
        const step = marqueeStep(
          position,
          max,
          direction,
          (PIXELS_PER_SECOND * (time - previous)) / 1000,
        );
        position = step.position;
        direction = step.direction;
        node.scrollLeft = position;
        written = node.scrollLeft;
      }
      previous = time;
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [ref, enabled, held]);

  return {
    running: enabled && !held,
    handlers: {
      onMouseEnter: hold,
      onMouseLeave: release,
      onFocusCapture: hold,
      onBlurCapture: release,
      onPointerDown: holdBriefly,
      onWheel: holdBriefly,
      onTouchStart: holdBriefly,
    },
  };
}
