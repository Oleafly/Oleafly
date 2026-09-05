// @vitest-environment jsdom

import { Profiler, useRef, type ProfilerOnRenderCallback } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/lib/theme";
import { clearHighlightCache } from "@/components/ui/code-highlighter";
import { clearMarkdownDocumentCache } from "@/components/ui/markdown-renderer";
import { clearDiagramCache } from "@/components/ui/mermaid-diagram";
import {
  installIntersectionObserverStub,
  type IntersectionObserverStub,
} from "@/components/ui/test-intersection-observer";
import { MessageItem } from "./chat-parts";
import { MessageList, type RenderedMessage } from "./MessageList";
import { buildHeavyConversation, HEAVY_CONVERSATION_COUNTS } from "./chat-render-fixture";

const mermaidRender = vi.hoisted(() => vi.fn());

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: mermaidRender,
  },
}));

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><text>diagram</text></svg>';

function expectFullyRendered(container: HTMLElement) {
  expect(container.querySelectorAll(".katex-display")).toHaveLength(
    HEAVY_CONVERSATION_COUNTS.displayEquations,
  );
  expect(container.querySelectorAll('[data-mermaid-diagram="true"][data-state="ready"]')).toHaveLength(
    HEAVY_CONVERSATION_COUNTS.mermaidDiagrams,
  );
  expect(container.querySelectorAll("pre code[data-language]")).toHaveLength(
    HEAVY_CONVERSATION_COUNTS.codeBlocks,
  );
  expect(container.querySelectorAll("pre code .tok-keyword").length).toBeGreaterThan(0);
}

async function settle(ms = 80) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function ListHarness({ messages }: { messages: RenderedMessage[] }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);
  return (
    <div ref={scrollRef} className="overflow-auto">
      <div className="flex flex-col gap-3">
        <MessageList
          messages={messages}
          chatId="heavy-chat"
          scrollRef={scrollRef}
          nearBottomRef={nearBottomRef}
        />
      </div>
    </div>
  );
}

describe("heavy chat render path", () => {
  let intersection: IntersectionObserverStub;

  beforeEach(() => {
    window.localStorage.setItem("oleafly.theme", "dark");
    clearMarkdownDocumentCache();
    clearDiagramCache();
    clearHighlightCache();
    mermaidRender.mockReset();
    mermaidRender.mockResolvedValue({ svg: SVG });
    intersection = installIntersectionObserverStub();
  });

  afterEach(() => {
    intersection.restore();
  });

  it("measures mount, remount, and theme switch cost for a large conversation", async () => {
    const messages = buildHeavyConversation();
    const commits: string[] = [];
    const onRender: ProfilerOnRenderCallback = (_id, phase) => {
      commits.push(phase);
    };
    const tree = (
      <ThemeProvider>
        <Profiler id="messages" onRender={onRender}>
          <div className="flex flex-col gap-3">
            {messages.map((msg) => (
              <div key={msg.id} data-message-role={msg.role} data-message-id={msg.id} className="min-w-0">
                <MessageItem msg={msg} />
              </div>
            ))}
          </div>
        </Profiler>
      </ThemeProvider>
    );

    const coldStart = performance.now();
    const first = render(tree);
    await waitFor(() => expectFullyRendered(first.container), { interval: 2, timeout: 30_000 });
    const coldMs = performance.now() - coldStart;
    const coldMermaidRenders = mermaidRender.mock.calls.length;
    first.unmount();

    const warmStart = performance.now();
    const second = render(tree);
    await waitFor(() => expectFullyRendered(second.container), { interval: 2, timeout: 30_000 });
    const warmMs = performance.now() - warmStart;
    const warmMermaidRenders = mermaidRender.mock.calls.length - coldMermaidRenders;
    await settle();

    const newest = second.container.querySelector(
      `[data-message-id="${messages[messages.length - 1].id}"]`,
    );
    intersection.setVisible((target) => target.closest("[data-message-id]") === newest);
    await settle();
    const visibleDiagrams = newest?.querySelectorAll('[data-mermaid-diagram="true"]').length ?? 0;

    commits.length = 0;
    const mermaidBeforeToggle = mermaidRender.mock.calls.length;
    const toggleStart = performance.now();
    act(() => {
      window.dispatchEvent(new Event("oleafly:toggle-theme"));
    });
    const toggleMs = performance.now() - toggleStart;
    expect(document.documentElement.classList.contains("light")).toBe(true);
    await settle();
    const toggleMermaidRenders = mermaidRender.mock.calls.length - mermaidBeforeToggle;
    const toggleCommits = commits.length;

    intersection.setVisible(() => true);
    await settle();
    const revealMermaidRenders =
      mermaidRender.mock.calls.length - mermaidBeforeToggle - toggleMermaidRenders;

    console.info(
      `[chat-render-performance] ${JSON.stringify({
        messages: messages.length,
        coldMountMs: Math.round(coldMs),
        warmRemountMs: Math.round(warmMs),
        coldMermaidRenders,
        warmMermaidRenders,
        themeToggleMs: Math.round(toggleMs * 100) / 100,
        visibleDiagramsAtToggle: visibleDiagrams,
        themeToggleMermaidRenders: toggleMermaidRenders,
        themeToggleMessageCommits: toggleCommits,
        revealMermaidRenders,
      })}`,
    );
    expect(warmMermaidRenders).toBe(0);
    expect(toggleCommits).toBe(0);
    expect(toggleMermaidRenders).toBe(visibleDiagrams);
    expect(revealMermaidRenders).toBe(HEAVY_CONVERSATION_COUNTS.mermaidDiagrams - visibleDiagrams);
  }, 60_000);

  it("paints the newest messages while older rows stay unmounted", async () => {
    const messages = buildHeavyConversation();
    const rendered: RenderedMessage[] = messages.map((msg, index) => ({
      key: msg.id ?? `${index}`,
      index,
      live: false,
      isLatestAssistant: index === messages.length - 1,
      msg,
    }));
    const newestIndex = messages.length - 1;
    const newestEquations = (messages[newestIndex].content.match(/\$\$/g)?.length ?? 0) / 2;

    const start = performance.now();
    const view = render(<ListHarness messages={rendered} />);
    await waitFor(
      () =>
        expect(
          view.container.querySelectorAll(`[data-mm-index="${newestIndex}"] .katex-display`),
        ).toHaveLength(newestEquations),
      { interval: 2, timeout: 30_000 },
    );
    const firstPaintMs = performance.now() - start;
    const mounted = view.container.querySelectorAll("[data-mm-index]").length;

    console.info(
      `[chat-render-performance] ${JSON.stringify({
        windowed: true,
        messages: messages.length,
        mounted,
        newestVisibleMs: Math.round(firstPaintMs),
      })}`,
    );
    expect(view.container.querySelector('[data-message-spacer="top"]')).not.toBeNull();
    expect(mounted).toBeLessThan(messages.length);
  }, 60_000);
});
