// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AcpPermission } from "@/lib/acp";
import { resetDisplayHomes, setDisplayHomes } from "@/lib/display-path";

vi.mock("@/components/editor/diff/InlineDiffPreview", () => ({
  InlineDiffPreview: ({ path, oldText, newText, ariaLabel }: { path: string; oldText: string; newText: string; ariaLabel?: string }) => (
    <section data-testid="inline-diff" data-path={path} aria-label={ariaLabel}>{`${oldText} -> ${newText}`}</section>
  ),
}));

import { initTestI18n } from "./tests/ui-fixtures";
import { PermissionCard } from "./PermissionCard";
import { ToolBadge } from "@/components/ai/chat-parts";

beforeAll(async () => {
  await initTestI18n();
});
afterEach(() => {
  cleanup();
  resetDisplayHomes();
});

const MAIN = "/Users/ada/.oleafly/projects/p/main.tex";

function permission(overrides: Partial<AcpPermission> = {}): AcpPermission {
  return {
    id: "request", sessionId: "saved", turnId: "turn", title: "Edit main.tex", toolCallId: "tool",
    options: [
      { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
      { optionId: "reject", name: "Reject", kind: "reject_once" },
    ],
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

describe("PermissionCard", () => {
  it("keeps the answer buttons above the proposed change", () => {
    render(
      <PermissionCard
        request={permission({
          kind: "edit",
          locations: ["main.tex"],
          diffs: [{ path: "main.tex", oldText: "old", newText: "new", truncated: false }],
        })}
        agentName="Pi"
        onChoose={vi.fn(async () => {})}
      />,
    );
    const allow = screen.getByRole("button", { name: "Allow once" });
    const show = screen.getByRole("button", { name: "Show change" });
    expect(allow.compareDocumentPosition(show) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("main.tex")).toBeInTheDocument();
  });

  it("shows one proposed change at a time, collapsed by default", async () => {
    render(
      <PermissionCard
        request={permission({
          locations: ["main.tex", "refs.bib", "notes.md"],
          diffs: [
            { path: "main.tex", oldText: "old intro", newText: "new intro", truncated: false },
            { path: "refs.bib", oldText: null, newText: "@article{a}", truncated: false },
          ],
        })}
        onChoose={vi.fn(async () => {})}
      />,
    );
    expect(screen.queryByTestId("inline-diff")).toBeNull();
    expect(screen.getByText("notes.md")).toBeInTheDocument();
    const [first, second] = screen.getAllByRole("button", { name: "Show change" });
    expect(first).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(first);
    expect(first).toHaveAttribute("aria-expanded", "true");
    expect(first).toHaveTextContent("Hide change");
    const diff = await screen.findByTestId("inline-diff");
    expect(diff).toHaveTextContent("old intro -> new intro");
    expect(diff).toHaveAttribute("aria-label", "Proposed change to main.tex");
    fireEvent.click(second);
    expect(first).toHaveAttribute("aria-expanded", "false");
    expect(await screen.findByTestId("inline-diff")).toHaveTextContent("-> @article{a}");
    expect(screen.getAllByTestId("inline-diff")).toHaveLength(1);
  });

  it("points to the turn review for a change too large to show", () => {
    render(
      <PermissionCard
        request={permission({ diffs: [{ path: "thesis.tex", oldText: null, newText: null, truncated: true }] })}
        onChoose={vi.fn(async () => {})}
      />,
    );
    expect(screen.getByText("Large change to thesis.tex. Review it after the turn.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show change" })).toBeNull();
  });

  it("shows a home path in the agent's request as ~ and still answers by id", () => {
    setDisplayHomes(["/Users/ada"]);
    const onChoose = vi.fn(async () => {});
    const { container } = render(
      <PermissionCard request={permission({ id: "request-1", title: `Edit ${MAIN}` })} onChoose={onChoose} />,
    );

    expect(screen.getByText("Edit ~/.oleafly/projects/p/main.tex")).toBeInTheDocument();
    expect(container.textContent).not.toContain("/Users/ada");

    fireEvent.click(screen.getByRole("button", { name: /Allow once/ }));
    expect(onChoose).toHaveBeenCalledWith("request-1", "allow-once");
  });

  it("shows a proposed change outside the project with the home folder as ~", () => {
    setDisplayHomes(["/Users/ada"]);
    const { container } = render(
      <PermissionCard
        request={permission({
          locations: ["/Users/ada/notes.md"],
          diffs: [{ path: "/Users/ada/refs.bib", oldText: null, newText: "@article{a}", truncated: false }],
        })}
        onChoose={vi.fn(async () => {})}
      />,
    );
    expect(screen.getByText("~/refs.bib")).toBeInTheDocument();
    expect(screen.getByText("~/notes.md")).toBeInTheDocument();
    expect(container.textContent).not.toContain("/Users/ada");
  });

  it("still works for requests without targets", () => {
    const onChoose = vi.fn(async () => {});
    render(<PermissionCard request={permission()} onChoose={onChoose} />);
    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
    expect(onChoose).toHaveBeenCalledWith("request", "allow-once");
    expect(screen.queryByRole("list")).toBeNull();
  });
});

describe("tool card diffs", () => {
  it("renders an agent's diff blocks as a collapsed real diff", async () => {
    render(
      <ToolBadge
        tc={{
          id: "edit",
          name: "Edit main.tex",
          status: "done",
          diffs: [
            { path: "main.tex", oldText: "a", newText: "b", truncated: false },
            { path: "big.tex", oldText: null, newText: null, truncated: true },
          ],
        }}
      />,
    );
    const list = screen.getByTestId("tool-diffs");
    expect(within(list).getByText("Large change to big.tex. Review it after the turn.")).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: "Show change" }));
    expect(await screen.findByTestId("inline-diff")).toHaveTextContent("a -> b");
  });
});
