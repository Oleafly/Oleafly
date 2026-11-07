// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatComposerHandle } from "@/components/ai/composer/ChatComposer";
import { loadNamespace } from "@/i18n";
import enAi from "@/i18n/locales/en/ai.json" with { type: "json" };
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { useComposerDrafts } from "@/store/composer-drafts";
import { useSettingsStore } from "@/store/settings";
import { AgentPrompt } from "./AgentPrompt";

interface Overrides {
  agents?: readonly string[];
  working?: boolean;
  quote?: string | null;
  message?: string | null;
}

function setup(overrides: Overrides = {}) {
  const onSend = vi.fn();
  const onStop = vi.fn();
  const onClearQuote = vi.fn();
  const composerRef = createRef<ChatComposerHandle>();
  const props = {
    composerRef,
    agents: overrides.agents ?? ["Claude Code", "Codex"],
    working: overrides.working ?? false,
    quote: overrides.quote ?? null,
    message: overrides.message ?? null,
    onClearQuote,
    onSend,
    onStop,
  };
  const view = render(<AgentPrompt {...props} />);
  const rerender = (next: Overrides) => view.rerender(<AgentPrompt {...props} {...next} />);
  return { onSend, onStop, onClearQuote, composerRef, rerender };
}

function textarea(): HTMLTextAreaElement {
  return screen.getByRole("combobox", { name: enNotes.prompt.label }) as HTMLTextAreaElement;
}

beforeAll(async () => {
  await loadNamespace("notes");
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
});

beforeEach(() => {
  localStorage.clear();
  useComposerDrafts.setState({ drafts: {} });
  useSettingsStore.setState({ aiComposerHeight: 56 });
});

describe("AgentPrompt", () => {
  it("sends the typed prompt to the first agent and clears the box", () => {
    const { onSend } = setup();
    expect(textarea()).toHaveAttribute("placeholder", enNotes.prompt.placeholder);
    fireEvent.change(textarea(), { target: { value: "  Summarize run 3  " } });
    fireEvent.keyDown(textarea(), { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith({ agent: "Claude Code", actionId: null, prompt: "Summarize run 3" });
    expect(textarea()).toHaveValue("");
  });

  it("lists the research actions when the person types a slash and runs the one they click", async () => {
    const { onSend } = setup();
    fireEvent.change(textarea(), { target: { value: "/" } });
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    for (const label of Object.values(enNotes.prompt.actions)) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText(enNotes.prompt.actionsGroup)).toBeInTheDocument();
    fireEvent.click(screen.getByText(enNotes.prompt.actions.citations));
    expect(onSend).toHaveBeenCalledWith({ agent: "Claude Code", actionId: "citations", prompt: "" });
    expect(textarea()).toHaveValue("");
  });

  it("runs the highlighted research action on Enter", async () => {
    const { onSend } = setup();
    fireEvent.change(textarea(), { target: { value: "/proofread" } });
    expect(await screen.findByRole("option", { name: enNotes.prompt.actions.proofread })).toBeInTheDocument();
    await waitFor(() =>
      expect(textarea()).toHaveAttribute("aria-activedescendant", "ai-slash-command-proofread"),
    );
    fireEvent.keyDown(textarea(), { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith({ agent: "Claude Code", actionId: "proofread", prompt: "" });
  });

  it("sends to the agent picked in the agent menu", async () => {
    const user = userEvent.setup();
    const { onSend } = setup();
    const trigger = screen.getByRole("button", { name: enNotes.prompt.agent });
    expect(trigger).toHaveTextContent("Claude Code");
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    expect(screen.getByRole("menuitemradio", { name: "Claude Code" })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("menuitemradio", { name: "Codex" }));
    expect(trigger).toHaveTextContent("Codex");
    fireEvent.change(textarea(), { target: { value: "Check the table" } });
    fireEvent.keyDown(textarea(), { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith({ agent: "Codex", actionId: null, prompt: "Check the table" });
  });

  it("offers Stop while the agent works and sends nothing until it is done", async () => {
    const { onSend, onStop } = setup({ working: true, message: "Codex has no changes for this note." });
    expect(screen.queryByText("Codex has no changes for this note.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: enAi.composer.send })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: enAi.composer.stop }));
    expect(onStop).toHaveBeenCalledOnce();

    fireEvent.change(textarea(), { target: { value: "Another request" } });
    fireEvent.keyDown(textarea(), { key: "Enter" });
    fireEvent.change(textarea(), { target: { value: "/" } });
    fireEvent.click(await screen.findByText(enNotes.prompt.actions.shorter));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("does nothing when no agent is installed", async () => {
    const { onSend } = setup({ agents: [] });
    expect(screen.getByRole("button", { name: enNotes.prompt.agent })).toHaveTextContent("");
    fireEvent.change(textarea(), { target: { value: "Hello" } });
    fireEvent.keyDown(textarea(), { key: "Enter" });
    fireEvent.change(textarea(), { target: { value: "/" } });
    fireEvent.click(await screen.findByText(enNotes.prompt.actions.abstract));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("shows the agent's message once it stops working", () => {
    const { rerender } = setup({ working: true, message: "Codex has no changes for this note." });
    expect(screen.queryByText("Codex has no changes for this note.")).not.toBeInTheDocument();
    rerender({ working: false, message: "Codex has no changes for this note." });
    expect(screen.getByText("Codex has no changes for this note.")).toBeInTheDocument();
    rerender({ working: false, message: null });
    expect(screen.queryByText("Codex has no changes for this note.")).not.toBeInTheDocument();
  });

  it("shows the quoted selection and removes it on request", () => {
    const { onClearQuote, rerender } = setup({ quote: "The encoder trains with a mask ratio of 0.75." });
    expect(screen.getByText("The encoder trains with a mask ratio of 0.75.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: enNotes.prompt.removeQuote }));
    expect(onClearQuote).toHaveBeenCalledOnce();
    rerender({ quote: null });
    expect(screen.queryByRole("button", { name: enNotes.prompt.removeQuote })).not.toBeInTheDocument();
  });

  it("hands the composer handle to the caller so it can focus the box", () => {
    const { composerRef } = setup();
    act(() => composerRef.current?.focus());
    expect(textarea()).toHaveFocus();
  });
});
