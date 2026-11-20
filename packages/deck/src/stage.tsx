import {
  forwardRef,
  isValidElement,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { DesignSystem } from "./design";
import type { Page, SlideMeta } from "./sdk";
import { SlideCanvas } from "./slide-canvas";
import { SlidePreloadLayer, type SlideWarmup } from "./slide-preload-layer";
import { SlideTransitionLayer } from "./slide-transition-layer";
import type { EntryDirection, StepAggregate, StepController } from "./step-context";
import type { SlideTransition } from "./transition";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion";

export interface DeckModule {
  readonly pages: Page[];
  readonly notes: readonly (string | undefined)[];
  readonly meta?: SlideMeta;
  readonly design?: DesignSystem;
  readonly transition?: SlideTransition;
}

export interface DeckPosition {
  readonly page: number;
  readonly revealed: number;
  readonly steps: number;
}

export interface DeckStageHandle {
  next(): void;
  previous(): void;
  goto(page: number): void;
}

export interface DeckStageProps {
  readonly deck: DeckModule;
  readonly page: number;
  readonly revealed?: number;
  readonly onPositionChange?: (position: DeckPosition) => void;
  readonly flat?: boolean;
  readonly keyboard?: boolean;
  readonly preload?: SlideWarmup;
}

function isPage(value: unknown): value is Page {
  if (typeof value === "function") return true;
  return typeof value === "object" && value !== null && "$$typeof" in value && !isValidElement(value);
}

export function readDeckModule(exports: Readonly<Record<string, unknown>>): DeckModule | null {
  const pages = exports.default;
  if (!Array.isArray(pages) || pages.length === 0 || !pages.every(isPage)) return null;
  const notes = Array.isArray(exports.notes)
    ? exports.notes.map((note) => (typeof note === "string" ? note : undefined))
    : [];
  return {
    pages: pages as Page[],
    notes,
    meta: exports.meta as SlideMeta | undefined,
    design: exports.design as DesignSystem | undefined,
    transition: exports.transition as SlideTransition | undefined,
  };
}

export function clampPage(page: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(total - 1, Math.max(0, Math.round(page)));
}

const FORWARD = new Set(["ArrowRight", "ArrowDown", " ", "PageDown", "Enter"]);
const BACKWARD = new Set(["ArrowLeft", "ArrowUp", "PageUp", "Backspace"]);
const EDITABLE = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

export function typingInto(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(EDITABLE) !== null;
}

export const DeckStage = forwardRef<DeckStageHandle, DeckStageProps>(function DeckStage(
  { deck, page, revealed, onPositionChange, flat = false, keyboard = false, preload = "neighbours" },
  ref,
) {
  const total = deck.pages.length;
  const [index, setIndex] = useState(() => clampPage(page, total));
  const [entryDirection, setEntryDirection] = useState<EntryDirection>(revealed === undefined ? "jump" : "forward");
  const resumeSteps = useRef(revealed ?? 0);
  const [aggregate, setAggregate] = useState<StepAggregate>({ revealed: 0, stepCount: 0 });
  const stepControllerRef = useRef<StepController | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const indexRef = useRef(index);
  indexRef.current = index;

  const show = useCallback(
    (next: number) => {
      const target = clampPage(next, total);
      const delta = target - indexRef.current;
      if (delta === 0) return;
      setEntryDirection(delta === 1 ? "forward" : delta === -1 ? "backward" : "jump");
      setIndex(target);
    },
    [total],
  );

  useEffect(() => {
    show(page);
  }, [page, show]);

  useEffect(() => {
    if (indexRef.current >= total) setIndex(clampPage(indexRef.current, total));
  }, [total]);

  const next = useCallback(() => {
    if (stepControllerRef.current?.advance()) return;
    show(indexRef.current + 1);
  }, [show]);

  const previous = useCallback(() => {
    if (stepControllerRef.current?.retreat()) return;
    show(indexRef.current - 1);
  }, [show]);

  useLayoutEffect(() => {
    let remaining = resumeSteps.current;
    while (remaining > 0 && stepControllerRef.current?.advance()) remaining -= 1;
  }, []);

  useImperativeHandle(ref, () => ({ next, previous, goto: show }), [next, previous, show]);

  const onAggregate = useCallback((value: StepAggregate) => {
    setAggregate((current) =>
      current.revealed === value.revealed && current.stepCount === value.stepCount ? current : value,
    );
  }, []);

  const report = useRef(onPositionChange);
  report.current = onPositionChange;
  useEffect(() => {
    report.current?.({ page: index, revealed: aggregate.revealed, steps: aggregate.stepCount });
  }, [index, aggregate]);

  useEffect(() => {
    if (!keyboard) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || typingInto(event.target)) return;
      if (FORWARD.has(event.key)) {
        event.preventDefault();
        next();
      } else if (BACKWARD.has(event.key)) {
        event.preventDefault();
        previous();
      } else if (event.key === "Home") {
        event.preventDefault();
        show(0);
      } else if (event.key === "End") {
        event.preventDefault();
        show(total - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keyboard, next, previous, show, total]);

  return (
    <SlideCanvas flat={flat} design={deck.design}>
      <SlideTransitionLayer
        pages={deck.pages}
        index={index}
        total={total}
        moduleTransition={deck.transition}
        disabled={reducedMotion}
        stepControllerRef={stepControllerRef}
        entryDirection={entryDirection}
        onStepAggregateChange={onAggregate}
      />
      <SlidePreloadLayer pages={deck.pages} index={index} design={deck.design} warmup={preload} />
    </SlideCanvas>
  );
});

