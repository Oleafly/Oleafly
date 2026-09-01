import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { RefObject } from "react";
import type { ChatMessage } from "@/store/chats";
import { cn } from "@/lib/utils";

function tickWidth(length: number): number {
  return Math.round(8 + Math.min(20, Math.log2(length + 1) * 2.6));
}

function firstLine(text: string): string {
  const trimmed = text.trim();
  const nl = trimmed.indexOf("\n");
  return nl === -1 ? trimmed : trimmed.slice(0, nl);
}

// The turn a prompt belongs to: the prompt and the assistant reply paired with
// it, so the hover card reads like the conversation at that point.
function turnPreview(messages: ChatMessage[], index: number): {
  user: string;
  assistant: string;
} {
  const message = messages[index];
  if (!message) return { user: "", assistant: "" };
  const next = messages[index + 1];
  return {
    user: message.content,
    assistant: next?.role === "assistant" ? next.content : "",
  };
}

/**
 * A conversation minimap for the full-width AI pane. One tick per user prompt,
 * the group centered vertically, the prompt whose turn is on screen
 * highlighted, a hover card previewing the turn, and click to scroll. Rendered
 * only when the caller says the pane is full width and there are at least two
 * prompts to move between.
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
  const prompts = useMemo(
    () =>
      messages
        .map((message, index) => ({ message, index }))
        .filter((entry) => entry.message.role === "user"),
    [messages],
  );
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [hover, setHover] = useState<{ index: number; top: number } | null>(null);
  const rafRef = useRef(0);

  const updateActive = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const marker = el.scrollTop + el.clientHeight / 2;
    let active: number | null = null;
    for (const { index } of prompts) {
      const node = el.querySelector<HTMLElement>(`[data-mm-index="${index}"]`);
      if (node && node.offsetTop <= marker) active = index;
    }
    setActiveIndex(active ?? prompts[0]?.index ?? null);
  }, [scrollRef, prompts]);

  useLayoutEffect(() => {
    if (visible) updateActive();
  }, [updateActive, visible]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !visible) return;
    const schedule = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updateActive);
    };
    el.addEventListener("scroll", schedule, { passive: true });
    return () => {
      el.removeEventListener("scroll", schedule);
      cancelAnimationFrame(rafRef.current);
    };
  }, [scrollRef, updateActive, visible]);

  if (!visible || prompts.length < 2) return null;

  const scrollTo = (index: number) => {
    const el = scrollRef.current;
    const node = el?.querySelector<HTMLElement>(`[data-mm-index="${index}"]`);
    if (el && node) el.scrollTo({ top: Math.max(0, node.offsetTop - 12), behavior: "smooth" });
  };

  const preview = hover ? turnPreview(messages, hover.index) : null;

  return (
    <div className="pointer-events-none absolute inset-y-0 left-0 z-20" aria-hidden>
      <div className="pointer-events-auto absolute inset-y-0 left-1.5 flex flex-col items-start justify-center gap-2">
        {prompts.map(({ message, index }) => {
          const active = index === activeIndex;
          const width = tickWidth(message.content.length);
          return (
            <button
              type="button"
              key={index}
              onClick={() => scrollTo(index)}
              onMouseEnter={(event) =>
                setHover({
                  index,
                  top:
                    event.currentTarget.offsetTop +
                    event.currentTarget.offsetHeight / 2,
                })
              }
              onMouseLeave={() =>
                setHover((current) => (current?.index === index ? null : current))
              }
              className="group flex h-3 items-center"
              title={firstLine(message.content)}
            >
              <span
                className={cn(
                  "block h-[2px] rounded-full transition-all duration-150",
                  active
                    ? "bg-foreground"
                    : "bg-muted-foreground/40 group-hover:bg-muted-foreground/75",
                )}
                style={{ width: active ? width + 8 : width }}
              />
            </button>
          );
        })}
        {hover && preview && (preview.user || preview.assistant) && (
          <div
            className="pointer-events-none absolute left-8 z-30 w-72 max-w-[70vw] -translate-y-1/2 rounded-lg border bg-popover p-3 text-xs shadow-xl"
            style={{ top: hover.top }}
          >
            <p className="line-clamp-2 font-semibold text-popover-foreground">
              {firstLine(preview.user)}
            </p>
            {preview.assistant && (
              <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-muted-foreground">
                {preview.assistant.trim()}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
