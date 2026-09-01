import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { ChatMessage } from "@/store/chats";
import { cn } from "@/lib/utils";

interface Tick {
  index: number;
  topPct: number;
  widthPx: number;
  role: ChatMessage["role"];
}

function tickWidth(length: number): number {
  return Math.round(6 + Math.min(22, Math.log2(length + 1) * 3));
}

function firstLine(text: string): string {
  const trimmed = text.trim();
  const nl = trimmed.indexOf("\n");
  return nl === -1 ? trimmed : trimmed.slice(0, nl);
}

// The turn a tick belongs to: the user prompt and the assistant reply paired
// with it, so the hover card reads like the conversation at that point.
function turnPreview(messages: ChatMessage[], index: number): {
  user: string;
  assistant: string;
} {
  const message = messages[index];
  if (!message) return { user: "", assistant: "" };
  if (message.role === "user") {
    const next = messages[index + 1];
    return {
      user: message.content,
      assistant: next?.role === "assistant" ? next.content : "",
    };
  }
  const prev = messages[index - 1];
  return {
    user: prev?.role === "user" ? prev.content : "",
    assistant: message.content,
  };
}

/**
 * A conversation minimap for the full-width AI pane: one tick per message
 * positioned by its scroll offset, the current message highlighted, a hover
 * preview of the turn, and click-to-scroll. Rendered only when the caller says
 * the pane is full width and there are at least two prompts.
 */
export function ChatMinimap({
  scrollRef,
  messages,
  visible,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  messages: ChatMessage[];
  visible: boolean;
}) {
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const rafRef = useRef(0);

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const total = el.scrollHeight;
    const nodes = el.querySelectorAll<HTMLElement>("[data-mm-index]");
    const next: Tick[] = [];
    for (const node of nodes) {
      const index = Number(node.dataset.mmIndex);
      const message = messages[index];
      if (!message) continue;
      next.push({
        index,
        topPct: total > 0 ? (node.offsetTop / total) * 100 : 0,
        widthPx: tickWidth(message.content.length),
        role: message.role,
      });
    }
    setTicks(next);
    const viewCenter = el.scrollTop + el.clientHeight / 2;
    let active = next[0]?.index ?? 0;
    for (const node of nodes) {
      if (node.offsetTop <= viewCenter) active = Number(node.dataset.mmIndex);
      else break;
    }
    setActiveIndex(active);
  }, [scrollRef, messages]);

  useLayoutEffect(() => {
    if (visible) measure();
  }, [measure, visible]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !visible) return;
    const schedule = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measure);
    };
    el.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", schedule);
      observer.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
  }, [scrollRef, measure, visible]);

  if (!visible || ticks.length < 2) return null;

  const scrollTo = (index: number) => {
    const el = scrollRef.current;
    const node = el?.querySelector<HTMLElement>(`[data-mm-index="${index}"]`);
    if (el && node) el.scrollTo({ top: Math.max(0, node.offsetTop - 12), behavior: "smooth" });
  };

  const hovered = hoverIndex == null ? null : ticks.find((t) => t.index === hoverIndex) ?? null;
  const preview = hovered ? turnPreview(messages, hovered.index) : null;

  return (
    <div
      className="pointer-events-none absolute inset-y-0 left-0 z-20 w-9"
      aria-hidden
    >
      <div className="pointer-events-auto absolute inset-y-4 left-1.5 right-0">
        {ticks.map((tick) => {
          const active = tick.index === activeIndex;
          return (
            <button
              type="button"
              key={tick.index}
              onClick={() => scrollTo(tick.index)}
              onMouseEnter={() => setHoverIndex(tick.index)}
              onMouseLeave={() =>
                setHoverIndex((current) => (current === tick.index ? null : current))
              }
              className="group absolute flex h-3 -translate-y-1/2 items-center"
              style={{ top: `${tick.topPct}%` }}
              title={firstLine(messages[tick.index]?.content ?? "")}
            >
              <span
                className={cn(
                  "block h-[2px] rounded-full transition-all duration-150",
                  active
                    ? "bg-foreground"
                    : tick.role === "user"
                      ? "bg-muted-foreground/45 group-hover:bg-muted-foreground/80"
                      : "bg-muted-foreground/25 group-hover:bg-muted-foreground/60",
                )}
                style={{ width: active ? tick.widthPx + 8 : tick.widthPx }}
              />
            </button>
          );
        })}
      </div>
      {hovered && preview && (preview.user || preview.assistant) && (
        <div
          className="pointer-events-none absolute left-9 z-30 w-72 max-w-[70vw] -translate-y-1/2 rounded-lg border bg-popover p-3 text-xs shadow-xl"
          style={{ top: `clamp(4rem, ${hovered.topPct}%, calc(100% - 4rem))` }}
        >
          {preview.user && (
            <p className="line-clamp-2 font-semibold text-popover-foreground">
              {firstLine(preview.user)}
            </p>
          )}
          {preview.assistant && (
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-muted-foreground">
              {preview.assistant.trim()}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
