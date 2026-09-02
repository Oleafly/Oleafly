// @vitest-environment jsdom

import { Profiler, type ProfilerOnRenderCallback } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme, ThemeProvider } from "@/lib/theme";
import { clearDiagramCache } from "@/components/ui/mermaid-diagram";
import {
  installIntersectionObserverStub,
  type IntersectionObserverStub,
} from "@/components/ui/test-intersection-observer";
import { MessageItem } from "./chat-parts";

const mermaidInitialize = vi.hoisted(() => vi.fn());
const mermaidRender = vi.hoisted(() => vi.fn());

vi.mock("mermaid", () => ({
  default: {
    initialize: mermaidInitialize,
    render: mermaidRender,
  },
}));

const DIAGRAM_A = "flowchart TD\n  A --> B";
const DIAGRAM_B = "flowchart LR\n  C --> D";

const messages = [
  {
    id: "user-1",
    role: "user" as const,
    content: "Explain $x^2$ with code",
  },
  {
    id: "assistant-1",
    role: "assistant" as const,
    content: `Here is the bound\n\n$$\n\\sum_{i=1}^{n} x_i^2\n$$\n\n\`\`\`javascript\nconst answer = 42;\n\`\`\`\n\n\`\`\`mermaid\n${DIAGRAM_A}\n\`\`\``,
  },
  {
    id: "assistant-2",
    role: "assistant" as const,
    content: `Another diagram\n\n\`\`\`mermaid\n${DIAGRAM_B}\n\`\`\``,
  },
];

async function settle(ms = 80) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

describe("theme switch with a rendered chat", () => {
  let intersection: IntersectionObserverStub;

  beforeEach(() => {
    window.localStorage.setItem("oleafly.theme", "dark");
    applyTheme("dark");
    clearDiagramCache();
    mermaidInitialize.mockClear();
    mermaidRender.mockReset();
    mermaidRender.mockResolvedValue({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>diagram</text></svg>',
    });
    intersection = installIntersectionObserverStub(
      (target) => target.closest('[data-message-id="assistant-2"]') === null,
    );
  });

  afterEach(() => {
    intersection.restore();
  });

  it("flips the root class without committing to any message and refreshes only visible diagrams", async () => {
    const commits: string[] = [];
    const onRender: ProfilerOnRenderCallback = (_id, phase) => {
      commits.push(phase);
    };
    const { container } = render(
      <ThemeProvider>
        <Profiler id="messages" onRender={onRender}>
          {messages.map((msg) => (
            <div key={msg.id} data-message-id={msg.id}>
              <MessageItem msg={msg} />
            </div>
          ))}
        </Profiler>
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(container.querySelectorAll(".katex").length).toBeGreaterThan(1);
      expect(container.querySelector("pre code .tok-keyword")).not.toBeNull();
      expect(
        container.querySelector('[data-message-id="assistant-1"] [data-mermaid-diagram][data-state="ready"]'),
      ).not.toBeNull();
    });
    await settle();
    expect(mermaidRender).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector('[data-message-id="assistant-2"] [data-mermaid-diagram][data-state="loading"]'),
    ).not.toBeNull();

    commits.length = 0;
    act(() => {
      window.dispatchEvent(new Event("oleafly:toggle-theme"));
    });

    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(commits).toHaveLength(0);

    await settle();
    expect(commits).toHaveLength(0);
    expect(mermaidRender).toHaveBeenCalledTimes(2);
    expect(mermaidRender.mock.calls[1][1]).toBe(DIAGRAM_A);
    expect(mermaidInitialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: "default" }),
    );
    expect(
      container.querySelector('[data-message-id="assistant-1"] [role="img"] svg'),
    ).not.toBeNull();

    intersection.setVisible(() => true);
    await waitFor(() =>
      expect(
        container.querySelector('[data-message-id="assistant-2"] [data-mermaid-diagram][data-state="ready"]'),
      ).not.toBeNull(),
    );
    expect(mermaidRender).toHaveBeenCalledTimes(3);
    expect(mermaidRender.mock.calls[2][1]).toBe(DIAGRAM_B);
    expect(mermaidInitialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: "default" }),
    );
  });
});
