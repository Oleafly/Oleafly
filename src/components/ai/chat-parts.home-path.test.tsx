// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDisplayHomes, setDisplayHomes } from "@/lib/display-path";
import { AgentStatusPill, MessageItem, ReasoningBlock } from "./chat-parts";

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

  it("shows a plan's home paths in the plan card as the bubble does", async () => {
    const reply = [
      "Here is the plan:",
      "1. Edit `/Users/ada/.oleafly/projects/p/main.tex`",
      "2. Compile /Users/ada/.oleafly/projects/p",
    ].join("\n");
    const todos = [
      "Edit /Users/ada/.oleafly/projects/p/main.tex",
      "Compile /Users/ada/.oleafly/projects/p",
    ].map((content, index) => ({ id: `${index}`, content, status: "pending" as const }));

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

  it("shows Windows home paths in the plan card as ~", () => {
    setDisplayHomes([String.raw`C:\Users\ada`]);
    const todos = [
      String.raw`Edit C:\Users\ada\paper\main_v2.tex: Rename the intro.`,
      String.raw`Compile: The PDF goes to C:\Users\ada\paper\out.pdf`,
    ].map((content, index) => ({ id: `${index}`, content, status: "pending" as const }));

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
