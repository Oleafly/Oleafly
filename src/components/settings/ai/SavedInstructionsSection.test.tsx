// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { SAVED_INSTRUCTION_LIMITS } from "@/lib/saved-instructions";
import type { AppConfig } from "@/lib/tauri";
import { SavedInstructionsSection } from "./SavedInstructionsSection";

const copy = enSettings.ai.instructions.savedInstructions;
const named = (template: string, name: string) => template.replace("{{name}}", name);
const keep = { id: "keep", name: "Keep formatting", text: "Keep the formatting." };
const quotes = { id: "quotes", name: "Quotes", text: "Don't change quoted text." };

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ai_system_prompt: "Untouched",
    ai_saved_instructions: [keep, quotes],
    ai_saved_instruction_uses: { quotes: 3 },
    ...overrides,
  } as AppConfig;
}

function renderSection(cfg = config(), persist = vi.fn(async (_next: AppConfig) => {})) {
  const view = render(<SavedInstructionsSection cfg={cfg} configLoaded persist={persist} />);
  return { ...view, persist };
}

describe("SavedInstructionsSection", () => {
  it("lists the saved instructions with the most used first", () => {
    renderSection();
    const rows = screen.getAllByTestId(/^saved-instruction-/u);
    expect(rows.map((row) => row.dataset.testid)).toEqual(["saved-instruction-quotes", "saved-instruction-keep"]);
    expect(within(rows[0]).getByText("3 uses")).toBeInTheDocument();
    expect(within(rows[1]).queryByText(/^\d+ uses?$/u)).not.toBeInTheDocument();
    expect(within(rows[1]).getByText(keep.text)).toBeInTheDocument();
  });

  it("explains an empty list", () => {
    renderSection(config({ ai_saved_instructions: [] }));
    expect(screen.getByText(copy.empty)).toBeInTheDocument();
  });

  it("adds an instruction to the end and closes the form", async () => {
    const { persist } = renderSection();
    fireEvent.click(screen.getByRole("button", { name: copy.add }));
    const name = screen.getByRole("textbox", { name: copy.name });
    expect(name).toHaveFocus();
    fireEvent.change(name, { target: { value: " Formal " } });
    fireEvent.change(screen.getByRole("textbox", { name: copy.text }), { target: { value: " Use a formal tone. " } });
    fireEvent.click(screen.getByRole("button", { name: enCommon.actions.save }));

    await waitFor(() => expect(persist).toHaveBeenCalledOnce());
    const next = persist.mock.calls[0][0];
    expect(next.ai_system_prompt).toBe("Untouched");
    expect(next.ai_saved_instructions).toEqual([
      keep,
      quotes,
      { id: expect.any(String), name: "Formal", text: "Use a formal tone." },
    ]);
    await waitFor(() => expect(screen.queryByTestId("saved-instruction-form")).not.toBeInTheDocument());
  });

  it("asks for both a name and some text", () => {
    const { persist } = renderSection();
    fireEvent.click(screen.getByRole("button", { name: copy.add }));
    fireEvent.change(screen.getByRole("textbox", { name: copy.name }), { target: { value: "Only a name" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: copy.name }), { key: "Enter" });
    expect(screen.getByText(copy.required)).toBeInTheDocument();
    expect(persist).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: enCommon.actions.cancel }));
    expect(screen.queryByTestId("saved-instruction-form")).not.toBeInTheDocument();
  });

  it("edits an instruction in place and keeps its id", async () => {
    const { persist } = renderSection();
    fireEvent.click(screen.getByRole("button", { name: named(copy.editNamed, "Keep formatting") }));
    const text = screen.getByRole("textbox", { name: copy.text });
    expect(text).toHaveValue(keep.text);
    fireEvent.change(text, { target: { value: "Keep the formatting and the line breaks." } });
    fireEvent.click(screen.getByRole("button", { name: enCommon.actions.save }));

    await waitFor(() => expect(persist).toHaveBeenCalledOnce());
    expect(persist.mock.calls[0][0].ai_saved_instructions).toEqual([
      { id: "keep", name: "Keep formatting", text: "Keep the formatting and the line breaks." },
      quotes,
    ]);
  });

  it("shows why a save failed and keeps the form open", async () => {
    const persist = vi.fn(async () => {
      throw new Error("disk full");
    });
    renderSection(config(), persist);
    fireEvent.click(screen.getByRole("button", { name: copy.add }));
    fireEvent.change(screen.getByRole("textbox", { name: copy.name }), { target: { value: "Formal" } });
    fireEvent.change(screen.getByRole("textbox", { name: copy.text }), { target: { value: "Be formal." } });
    fireEvent.click(screen.getByRole("button", { name: enCommon.actions.save }));
    expect(await screen.findByText(/disk full/u)).toBeInTheDocument();
    expect(screen.getByTestId("saved-instruction-form")).toBeInTheDocument();
  });

  it("deletes only after confirming", async () => {
    const { persist } = renderSection();
    fireEvent.click(screen.getByRole("button", { name: named(copy.deleteNamed, "Quotes") }));
    expect(screen.getByText(named(copy.deleteDescription, "Quotes"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: enCommon.actions.cancel }));
    expect(persist).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: named(copy.deleteNamed, "Quotes") }));
    fireEvent.click(screen.getByRole("button", { name: enCommon.actions.delete }));
    await waitFor(() => expect(persist).toHaveBeenCalledOnce());
    expect(persist.mock.calls[0][0].ai_saved_instructions).toEqual([keep]);
  });

  it("stops adding at the limit", () => {
    const full = Array.from({ length: SAVED_INSTRUCTION_LIMITS.count }, (_, index) => ({
      id: `n${index}`,
      name: `Rule ${index}`,
      text: "t",
    }));
    renderSection(config({ ai_saved_instructions: full }));
    expect(screen.getByRole("button", { name: copy.add })).toBeDisabled();
    expect(
      screen.getByText(copy.limit.replace("{{max}}", String(SAVED_INSTRUCTION_LIMITS.count))),
    ).toBeInTheDocument();
  });
});
