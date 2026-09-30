// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDisplayHomes, setDisplayHomes } from "@/lib/display-path";
import { usePersonalDetailsStore } from "@/store/personal-details";
import { AgentStatusPill, MessageItem, ReasoningBlock } from "./chat-parts";
import { lastNumberedList, planTodos } from "./plan-from-reply";

const REPLY = [
  'I updated /Users/ada/.oleafly/projects/p/main.tex; the old copy is at "/Users/ada/.oleafly/projects/p/old.tex".',
  "",
  "```bash",
  'cp "/Users/ada/My Docs/a.tex" .',
  "```",
].join("\n");

beforeAll(async () => {
  // Keep cold loading of the lazy renderer outside the waitFor deadline.
  await import("@/components/ui/markdown-renderer");
});

describe("home paths in chat messages", () => {
  const writeText = vi.fn(async () => {});

  beforeEach(() => {
    setDisplayHomes(["/Users/ada"]);
    writeText.mockClear();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  });

  afterEach(() => resetDisplayHomes());

  it("shows an assistant reply with ~ but copies the real text", async () => {
    const { container } = render(<MessageItem msg={{ role: "assistant", content: REPLY }} />);
    const prose = await waitFor(() => {
      const paragraph = container.querySelector(".chat-markdown p");
      expect(paragraph).not.toBeNull();
      return paragraph as HTMLElement;
    });

    expect(prose.textContent).toBe(
      'I updated ~/.oleafly/projects/p/main.tex; the old copy is at "~/.oleafly/projects/p/old.tex".',
    );
    // Two `~` in one paragraph must not turn into strikethrough.
    expect(container.querySelector("del")).toBeNull();
    // Fenced code keeps the real path: its own copy button copies what it shows.
    expect(container.querySelector("pre")?.textContent).toContain('cp "/Users/ada/My Docs/a.tex" .');

    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
    expect(writeText).toHaveBeenCalledWith(REPLY);
  });

  it("leaves what the user typed as written", async () => {
    const { container } = render(
      <MessageItem msg={{ role: "user", content: "Open /Users/ada/notes" }} />,
    );
    await waitFor(() => expect(container.textContent).toContain("Open /Users/ada/notes"));
  });

  it("shows a text plan's home paths in the plan card as the bubble does, and keeps the plan raw", async () => {
    const reply = [
      "Here is the plan:",
      "1. Edit `/Users/ada/.oleafly/projects/p/main.tex`",
      "2. Compile /Users/ada/.oleafly/projects/p",
    ].join("\n");
    const todos = planTodos(lastNumberedList(reply));
    // The model gets the plan back as written, so the stored steps keep the real path.
    expect(todos.map((todo) => todo.content)).toEqual([
      "Edit /Users/ada/.oleafly/projects/p/main.tex",
      "Compile /Users/ada/.oleafly/projects/p",
    ]);

    const { container } = render(
      <>
        <MessageItem msg={{ role: "assistant", content: reply }} />
        <AgentStatusPill
          todos={todos}
          turn={null}
          approval={{ status: "awaiting", onApprove: () => {}, onRevise: () => {} }}
        />
      </>,
    );
    const bubbleSteps = await waitFor(() => {
      const items = [...container.querySelectorAll(".chat-markdown li")];
      expect(items).toHaveLength(2);
      return items.map((item) => item.textContent);
    });
    fireEvent.mouseEnter(screen.getByTestId("agent-status-pill"));
    const card = screen.getByTestId("agent-todos");
    const cardSteps = [...card.querySelectorAll("li")];

    expect(cardSteps.map((item) => item.textContent)).toEqual(bubbleSteps);
    expect(bubbleSteps).toEqual([
      "Edit ~/.oleafly/projects/p/main.tex",
      "Compile ~/.oleafly/projects/p",
    ]);
    expect(cardSteps[0].getAttribute("aria-label")).toContain("~/.oleafly/projects/p/main.tex");
    expect(card.innerHTML).not.toContain("/Users/ada");
  });

  it("shows home paths in a step with a folded description as ~, on Windows too", () => {
    setDisplayHomes([String.raw`C:\Users\ada`]);
    const reply = [
      "Plan:",
      String.raw`1. Edit C:\Users\ada\paper\main_v2.tex`,
      "   Rename the intro.",
      "2. Compile",
      String.raw`   The PDF goes to C:\Users\ada\paper\out.pdf`,
    ].join("\r\n");
    const todos = planTodos(lastNumberedList(reply));
    expect(todos.map((todo) => todo.content)).toEqual([
      String.raw`Edit C:\Users\ada\paper\main_v2.tex: Rename the intro.`,
      String.raw`Compile: The PDF goes to C:\Users\ada\paper\out.pdf`,
    ]);

    render(
      <AgentStatusPill
        todos={todos}
        turn={null}
        approval={{ status: "awaiting", onApprove: () => {}, onRevise: () => {} }}
      />,
    );
    fireEvent.mouseEnter(screen.getByTestId("agent-status-pill"));
    const card = screen.getByTestId("agent-todos");
    expect([...card.querySelectorAll("li")].map((item) => item.textContent)).toEqual([
      String.raw`Edit ~\paper\main_v2.tex: Rename the intro.`,
      String.raw`Compile: The PDF goes to ~\paper\out.pdf`,
    ]);
    expect(card.innerHTML).not.toContain("Users");
  });

  it("shows home paths in the agent's reasoning as ~", () => {
    render(<ReasoningBlock text="Reading /Users/ada/.oleafly/projects/p/main.tex" />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("Reading ~/.oleafly/projects/p/main.tex")).toBeInTheDocument();
  });
});

describe("chat bubbles in screenshot mode", () => {
  beforeEach(() => {
    setDisplayHomes(["/Users/ada"]);
    act(() => usePersonalDetailsStore.getState().setHidden(true));
  });

  afterEach(() => {
    act(() => usePersonalDetailsStore.getState().setHidden(false));
    resetDisplayHomes();
  });

  it("adds no focus stop to a bubble with nothing personal in it", async () => {
    const { container } = render(
      <MessageItem msg={{ role: "user", content: "Tighten the abstract" }} />,
    );
    await waitFor(() => expect(container.textContent).toContain("Tighten the abstract"));
    expect(container.querySelector("[data-private-group]")).toBeNull();
    expect(container.querySelector("[tabindex]")).toBeNull();
  });

  it("makes a bubble with a home path one focus stop that reveals it", async () => {
    const { container } = render(
      <MessageItem msg={{ role: "user", content: "Open /Users/ada/notes/draft.tex" }} />,
    );
    const path = await waitFor(() => {
      const marked = container.querySelector("[data-private]");
      expect(marked).not.toBeNull();
      return marked as HTMLElement;
    });
    const group = container.querySelector("[data-private-group]");
    expect(group).toHaveAttribute("tabindex", "0");
    expect(group).toContainElement(path);
    // The group keeps the bubble's own colours; the focus tint is drawn over them.
    expect(group).toHaveClass("bg-primary", "rounded-lg");
  });
});
