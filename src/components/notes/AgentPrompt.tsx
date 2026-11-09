import { ChevronDown, Sparkles, Square } from "lucide-react";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { prefersReducedMotion } from "@/lib/reduced-motion";
import { cn } from "@/lib/utils";
import { matchesShortcut, shortcutLabel, type ShortcutBinding } from "@/store/shortcuts";
import { readPromptCollapsed, savePromptCollapsed } from "./note-prefs";

export interface PromptDockHandle {
  expand: (focus: boolean) => void;
  collapse: () => void;
}

interface PromptDockProps {
  handle?: Ref<PromptDockHandle>;
  shortcutScope?: RefObject<HTMLElement | null>;
  detail: string;
  working: boolean;
  onStop?: () => void;
  focusComposer: () => void;
  children: ReactNode;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const FADE_OUT_MS = 90;
const SHELL_DELAY_MS = 50;
const SHELL_MS = 260;
const FADE_IN_DELAY_MS = 230;
const FADE_IN_MS = 140;
const TOGGLE_BINDING: ShortcutBinding = { key: "j", mod: true };

function boxOf(element: Element, origin: DOMRect): Box {
  const rect = element.getBoundingClientRect();
  const radius = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
  return {
    x: rect.left - origin.left,
    y: rect.top - origin.top,
    width: rect.width,
    height: rect.height,
    radius: Math.min(radius, rect.width / 2, rect.height / 2),
  };
}

function shellFrame(box: Box): Keyframe {
  return {
    opacity: 1,
    transform: `translate(${box.x}px, ${box.y}px)`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    borderRadius: `${box.radius}px`,
  };
}

export function ShortcutLabel({ label }: Readonly<{ label: string }>) {
  return (
    <span className="flex items-center gap-1.5">
      {label}
      <Kbd>{shortcutLabel(TOGGLE_BINDING)}</Kbd>
    </span>
  );
}

export function GlowRing() {
  return <span aria-hidden data-glow-ring className="note-prompt-glow-ring" />;
}

export function CollapsePromptButton({ onCollapse }: Readonly<{ onCollapse: () => void }>) {
  const { t } = useTranslation(["notes"]);
  return (
    <div className="absolute right-2 top-2 z-10">
      <Tooltip label={<ShortcutLabel label={t(($) => $.notes.prompt.collapse)} />} side="top">
        <button
          type="button"
          aria-label={t(($) => $.notes.prompt.collapse)}
          aria-expanded
          onClick={onCollapse}
          className="flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent"
        >
          <ChevronDown aria-hidden className="size-3.5" />
        </button>
      </Tooltip>
    </div>
  );
}

function composerText(panel: HTMLElement | null): string {
  const field = panel?.querySelector("textarea");
  return field instanceof HTMLTextAreaElement ? field.value : "";
}

export function PromptDock({
  handle,
  shortcutScope,
  detail,
  working,
  onStop,
  focusComposer,
  children,
}: Readonly<PromptDockProps>) {
  const { t } = useTranslation(["notes", "ai"]);
  const [collapsed, setCollapsed] = useState(readPromptCollapsed);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const morphRef = useRef<HTMLDivElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const motion = useRef<Animation[]>([]);
  const pending = useRef<{ focus: boolean } | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;
  const focusRef = useRef(focusComposer);
  focusRef.current = focusComposer;

  const change = useCallback((next: boolean, focus: boolean) => {
    if (next === collapsedRef.current) {
      if (focus) focusRef.current();
      return;
    }
    const active = document.activeElement;
    if (!next && active instanceof HTMLElement && !rootRef.current?.contains(active)) returnFocus.current = active;
    pending.current = { focus };
    setCollapsed(next);
    savePromptCollapsed(next);
  }, []);

  useImperativeHandle(
    handle,
    () => ({
      expand: (focus) => change(false, focus),
      collapse: () => change(true, false),
    }),
    [change],
  );

  useLayoutEffect(() => {
    const request = pending.current;
    const root = rootRef.current;
    const panel = panelRef.current;
    const pill = pillRef.current;
    const morph = morphRef.current;
    if (!request || !root || !panel || !pill || !morph) return;
    pending.current = null;
    const shell = panel.querySelector("[data-chat-composer]")?.lastElementChild ?? panel;
    const origin = root.getBoundingClientRect();
    const running = motion.current.length > 0;
    const from = boxOf(running ? morph : collapsed ? shell : pill, origin);
    const to = boxOf(collapsed ? pill : shell, origin);
    for (const animation of motion.current) animation.cancel();
    motion.current = [];
    if (collapsed) {
      if (panel.contains(document.activeElement)) {
        const back = returnFocus.current;
        (back?.isConnected ? back : expandRef.current)?.focus({ preventScroll: true });
      }
      returnFocus.current = null;
    } else if (request.focus) {
      focusRef.current();
    }
    if (prefersReducedMotion() || typeof morph.animate !== "function") return;
    const leaving = collapsed ? panel : pill;
    const arriving = collapsed ? pill : panel;
    const started = [
      leaving.animate(
        [
          { opacity: 1, transform: "scale(1)" },
          { opacity: 0, transform: "scale(0.98)" },
        ],
        { duration: FADE_OUT_MS, easing: "ease-out" },
      ),
      morph.animate([shellFrame(from), shellFrame(to)], {
        duration: SHELL_MS,
        delay: SHELL_DELAY_MS,
        easing: EASE,
        fill: "both",
      }),
      arriving.animate(
        [
          { opacity: 0, transform: "scale(0.98)" },
          { opacity: 1, transform: "scale(1)" },
        ],
        { duration: FADE_IN_MS, delay: FADE_IN_DELAY_MS, easing: "ease-out", fill: "backwards" },
      ),
    ];
    motion.current = started;
    void Promise.all(started.map((animation) => animation.finished)).then(
      () => {
        if (motion.current !== started) return;
        for (const animation of started) animation.cancel();
        motion.current = [];
      },
      () => undefined,
    );
  }, [collapsed]);

  useEffect(
    () => () => {
      for (const animation of motion.current) animation.cancel();
    },
    [],
  );

  useEffect(() => {
    const scope = shortcutScope?.current;
    if (!scope) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesShortcut(event, TOGGLE_BINDING)) return;
      event.preventDefault();
      if (collapsedRef.current) change(false, true);
      else if (composerText(panelRef.current).trim() === "") change(true, false);
      else focusRef.current();
    };
    scope.addEventListener("keydown", onKeyDown);
    return () => scope.removeEventListener("keydown", onKeyDown);
  }, [change, shortcutScope]);

  return (
    <div ref={rootRef} data-prompt-state={collapsed ? "collapsed" : "expanded"} className="relative">
      <div
        ref={morphRef}
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 size-0 border bg-card opacity-0 shadow-sm"
      />
      <div
        ref={panelRef}
        inert={collapsed}
        aria-hidden={collapsed || undefined}
        className={cn(
          "relative mx-auto max-w-2xl space-y-2",
          collapsed ? "pointer-events-none opacity-0" : "pointer-events-auto",
        )}
      >
        {children}
      </div>
      <div
        ref={pillRef}
        inert={!collapsed}
        aria-hidden={!collapsed || undefined}
        className={cn(
          "absolute bottom-0 right-0 flex h-9 max-w-full items-center gap-0.5 rounded-full border bg-card p-1 shadow-sm",
          collapsed ? "pointer-events-auto" : "pointer-events-none opacity-0",
        )}
      >
        <Tooltip label={<ShortcutLabel label={t(($) => $.notes.prompt.expand)} />} side="top" className="min-w-0">
          <button
            ref={expandRef}
            type="button"
            aria-label={`${t(($) => $.notes.assistant.label)} ${detail}`}
            aria-expanded={false}
            onClick={() => change(false, true)}
            className="flex h-7 min-w-0 items-center gap-1.5 rounded-full px-2.5 text-sm transition-colors hover:bg-accent focus-visible:bg-accent"
          >
            {working ? <Spinner size="sm" /> : <Sparkles aria-hidden className="size-3.5 shrink-0 text-primary" />}
            <span className="shrink-0 font-medium">{t(($) => $.notes.assistant.label)}</span>
            {detail && <span className="min-w-0 truncate text-muted-foreground">{detail}</span>}
          </button>
        </Tooltip>
        {working && onStop && (
          <button
            type="button"
            onClick={onStop}
            className="flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent"
          >
            <Square aria-hidden className="size-3 fill-current" />
            {t(($) => $.ai.composer.stop)}
          </button>
        )}
      </div>
    </div>
  );
}
