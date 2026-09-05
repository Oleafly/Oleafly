import { useRef } from "react";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

const { restore } = await vi.hoisted(async () => {
  vi.resetModules();
  const { installUiDom } = await import("./acp/tests/ui-fixtures");
  return installUiDom();
});
import { AgentMentionMenu } from "./AgentMentionMenu";
import type { SlashCommandMenuHandle } from "./SlashCommandMenu";
import { agentDelegationPrompt, type DelegationTarget } from "@/lib/agent-mentions";

const targets: DelegationTarget[] = [
  { id: "local", label: "Local researcher", detail: "Ollama model llama", runtime: "built-in", providerId: "ollama", modelId: "llama" },
  { id: "reviewer", label: "CLI reviewer", detail: "Research CLI model chosen", runtime: "acp", agentId: "research-cli", modelId: "chosen" },
  { id: "writer", label: "Manuscript writer", detail: "Remote model draft", runtime: "built-in", providerId: "configured-provider", modelId: "draft" },
];

function Harness(props: React.ComponentProps<typeof AgentMentionMenu>) {
  const menu = useRef<SlashCommandMenuHandle>(null);
  return <><textarea aria-label="Composer" onKeyDown={(event) => menu.current?.handleKeyDown(event)} /><AgentMentionMenu ref={menu} {...props} /></>;
}

function props(query = "") { return { targets, query, onSelect: vi.fn(), onClose: vi.fn(), onActiveChange: vi.fn() }; }
afterEach(cleanup);
afterAll(restore);

describe("agent mention selection", () => {
  it("filters across names and model details and preserves the selected delegation IDs", () => {
    const input = props("CHOSEN");
    const ui = render(<Harness {...input} />);
    expect(ui.getAllByRole("option")).toHaveLength(1);
    expect(ui.getByRole("option")).toHaveAttribute("aria-selected", "true");
    expect(input.onActiveChange).toHaveBeenLastCalledWith("reviewer");
    fireEvent.focusIn(ui.getByLabelText("Composer"));
    fireEvent.keyDown(ui.getByLabelText("Composer"), { key: "Enter" });
    expect(input.onSelect).toHaveBeenCalledExactlyOnceWith(targets[1]);
    const selection = input.onSelect.mock.calls[0][0] as DelegationTarget;
    const prompt = agentDelegationPrompt(`@${selection.id} review the methods`, [selection]);
    expect(prompt).toContain('"runtime":"acp"');
    expect(prompt).toContain('"agentId":"research-cli"');
    expect(prompt).toContain('"modelId":"chosen"');
    expect(prompt).not.toContain('"providerId"');
  });

  it("wraps keyboard navigation and resets active selection when filtering removes it", () => {
    const input = props();
    const ui = render(<Harness {...input} />);
    const composer = ui.getByLabelText("Composer");
    fireEvent.focusIn(composer);
    fireEvent.keyDown(composer, { key: "ArrowUp" });
    expect(input.onActiveChange).toHaveBeenLastCalledWith("writer");
    fireEvent.keyDown(composer, { key: "ArrowDown" });
    expect(input.onActiveChange).toHaveBeenLastCalledWith("local");
    fireEvent.keyDown(composer, { key: "ArrowDown" });
    ui.rerender(<Harness {...input} query="ollama" />);
    expect(input.onActiveChange).toHaveBeenLastCalledWith("local");
    fireEvent.keyDown(composer, { key: "Tab" });
    expect(input.onSelect).toHaveBeenCalledExactlyOnceWith(targets[0]);
    ui.rerender(<Harness {...input} query="missing" />);
    expect(ui.queryByRole("option")).not.toBeInTheDocument();
    expect(input.onActiveChange).toHaveBeenLastCalledWith(null);
    fireEvent.keyDown(composer, { key: "Enter" });
    expect(input.onSelect).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(composer, { key: "Escape" });
    expect(input.onClose).toHaveBeenCalledOnce();
  });

  it("keeps IME composition and shifted Enter in the composer, and mouse selection preserves focus", () => {
    const input = props();
    const ui = render(<Harness {...input} />);
    const composer = ui.getByLabelText("Composer");
    composer.focus();
    fireEvent.keyDown(composer, { key: "Enter", isComposing: true });
    fireEvent.keyDown(composer, { key: "Enter", shiftKey: true });
    expect(input.onSelect).not.toHaveBeenCalled();
    const option = ui.getByRole("option", { name: /CLI reviewer/ });
    expect(fireEvent.mouseDown(option)).toBe(false);
    expect(document.activeElement).toBe(composer);
    fireEvent.click(option);
    expect(input.onSelect).toHaveBeenCalledExactlyOnceWith(targets[1]);
  });
});
