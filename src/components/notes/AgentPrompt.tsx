import { ChevronDown, Quote, Sparkles, Square, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import { ChatComposer, type ChatComposerHandle, type SlashItem } from "@/components/ai/composer/ChatComposer";
import { ModelSelector, type ModelSelectorGroup } from "@/components/ai/ModelSelector";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { cn, shortcut } from "@/lib/utils";
import { choiceIn } from "./note-agent";
import { readPromptCollapsed, savePromptCollapsed } from "./note-prefs";
import { isResearchAction, RESEARCH_ACTIONS } from "./research-actions";
import type { NoteAgentChoice, ResearchActionId } from "./types";

export interface PromptRequest {
  actionId: ResearchActionId | null;
  prompt: string;
}

interface AgentPromptProps {
  composerRef: RefObject<ChatComposerHandle | null>;
  shortcutScope?: RefObject<HTMLElement | null>;
  agents: readonly ModelSelectorGroup[];
  hiddenActions: ReadonlySet<ResearchActionId>;
  choice: NoteAgentChoice;
  onChoice: (choice: NoteAgentChoice) => void;
  working: boolean;
  quote: string | null;
  message: string | null;
  onClearQuote: () => void;
  onSend: (request: PromptRequest) => void;
  onStop: () => void;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

const NO_ATTACHMENTS: [] = [];
const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const FADE_OUT_MS = 90;
const SHELL_DELAY_MS = 50;
const SHELL_MS = 260;
const FADE_IN_DELAY_MS = 230;
const FADE_IN_MS = 140;
const TOGGLE_KEYS = "⌘J";

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

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function isToggleKey(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "j";
}

function ShortcutLabel({ label }: Readonly<{ label: string }>) {
  return (
    <span className="flex items-center gap-1.5">
      {label}
      <Kbd>{shortcut(TOGGLE_KEYS)}</Kbd>
    </span>
  );
}

export function AgentPrompt({
  composerRef,
  shortcutScope,
  agents,
  hiddenActions,
  choice,
  onChoice,
  working,
  quote,
  message,
  onClearQuote,
  onSend,
  onStop,
}: Readonly<AgentPromptProps>) {
  const { t } = useTranslation(["notes", "ai"]);
  const [text, setText] = useState("");
  const [collapsed, setCollapsed] = useState(readPromptCollapsed);
  const composer = useRef<ChatComposerHandle>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const morphRef = useRef<HTMLDivElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const motion = useRef<Animation[]>([]);
  const pending = useRef<{ focus: boolean } | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const state = useRef({ collapsed, text });
  state.current = { collapsed, text };
  const slashItems = useMemo<SlashItem[]>(
    () =>
      RESEARCH_ACTIONS.filter(({ id }) => !hiddenActions.has(id)).map(({ id, icon }) => ({
        id,
        label: t(($) => $.notes.prompt.actions[id]),
        icon,
        group: t(($) => $.notes.prompt.actionsGroup),
      })),
    [hiddenActions, t],
  );

  const change = useCallback((next: boolean, focus: boolean) => {
    if (next === state.current.collapsed) {
      if (focus) composer.current?.focus();
      return;
    }
    const active = document.activeElement;
    if (!next && active instanceof HTMLElement && !rootRef.current?.contains(active)) returnFocus.current = active;
    pending.current = { focus };
    setCollapsed(next);
    savePromptCollapsed(next);
  }, []);

  useImperativeHandle(
    composerRef,
    () => ({
      focus: () => change(false, true),
      setCaret: (position) => composer.current?.setCaret(position),
      insertText: (value) => composer.current?.insertText(value),
      openFilePicker: () => composer.current?.openFilePicker(),
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
      composer.current?.focus();
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
      if (!isToggleKey(event)) return;
      event.preventDefault();
      const current = state.current;
      if (current.collapsed) change(false, true);
      else if (current.text.trim() === "") change(true, false);
      else composer.current?.focus();
    };
    scope.addEventListener("keydown", onKeyDown);
    return () => scope.removeEventListener("keydown", onKeyDown);
  }, [change, shortcutScope]);

  const send = (actionId: ResearchActionId | null) => {
    if (working) return;
    onSend({ actionId, prompt: actionId ? "" : text.trim() });
    setText("");
  };

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
        {message && !working && (
          <p className="rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground">{message}</p>
        )}
        {quote && (
          <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-xs text-muted-foreground">
            <Quote aria-hidden className="size-3 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{quote}</span>
            <button
              type="button"
              aria-label={t(($) => $.notes.prompt.removeQuote)}
              className="flex size-5 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:bg-accent"
              onClick={onClearQuote}
            >
              <X aria-hidden className="size-3" />
            </button>
          </div>
        )}
        <div className="relative">
          <ChatComposer
            ref={composer}
            composerId="notes"
            value={text}
            onChange={setText}
            onSubmit={() => send(null)}
            busy={working}
            onStop={onStop}
            placeholder={t(($) => $.notes.prompt.placeholder)}
            attachments={NO_ATTACHMENTS}
            slashItems={slashItems}
            onSlashSelect={(item) => {
              if (isResearchAction(item.id)) send(item.id);
            }}
            labels={{ textarea: t(($) => $.notes.prompt.label) }}
            shellClassName="[&_textarea]:pr-7"
            controls={
              <ModelSelector
                compact
                providerId={choice.providerId}
                modelId={choice.modelId}
                groups={[...agents]}
                disabled={working}
                onChange={(providerId, modelId) => {
                  const next = choiceIn(agents, providerId, modelId);
                  if (next) onChoice(next);
                }}
              />
            }
          />
          <div className="absolute right-2 top-2 z-10">
            <Tooltip label={<ShortcutLabel label={t(($) => $.notes.prompt.collapse)} />} side="top">
              <button
                type="button"
                aria-label={t(($) => $.notes.prompt.collapse)}
                aria-expanded
                onClick={() => change(true, false)}
                className="flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent"
              >
                <ChevronDown aria-hidden className="size-3.5" />
              </button>
            </Tooltip>
          </div>
        </div>
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
            aria-label={`${t(($) => $.notes.prompt.label)} ${choice.label}`}
            aria-expanded={false}
            onClick={() => change(false, true)}
            className="flex h-7 min-w-0 items-center gap-1.5 rounded-full px-2.5 text-sm transition-colors hover:bg-accent focus-visible:bg-accent"
          >
            {working ? <Spinner size="sm" /> : <Sparkles aria-hidden className="size-3.5 shrink-0 text-primary" />}
            <span className="shrink-0 font-medium">{t(($) => $.notes.prompt.label)}</span>
            <span className="min-w-0 truncate text-muted-foreground">{choice.label}</span>
          </button>
        </Tooltip>
        {working && (
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
