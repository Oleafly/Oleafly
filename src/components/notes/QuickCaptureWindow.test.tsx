// @vitest-environment jsdom

import type { Editor } from "@tiptap/core";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { NOTES_PERIODIC_DEFAULTS, NOTES_PERIODIC_KEY } from "@/lib/notes-periodic";
import "./tests/setup";
import type { CaptureRequest } from "./quick-capture";
import { type CaptureBridge, QuickCaptureWindow } from "./QuickCaptureWindow";
import { typeInto } from "./tests/kb-editor-fixtures";

const strings = enNotes.quickCapture;
const DRAFT_KEY = "oleafly.notes.quickCapture.draft";

type FakeBridge = CaptureBridge & { show: () => void };

function bridge(reply: (request: CaptureRequest) => Promise<{ id: string; noteId?: string; error?: string }>): FakeBridge {
  let shown: () => void = () => {};
  return {
    submit: vi.fn(reply),
    hide: vi.fn(),
    onShown: (callback) => {
      shown = callback;
      return () => {};
    },
    openNotes: vi.fn(),
    windowButtons: vi.fn(),
    show: () => shown(),
  };
}

const ok = async (request: CaptureRequest) => ({ id: request.id, noteId: "n1" });

function dailyNotes(enabled: boolean): void {
  localStorage.setItem(NOTES_PERIODIC_KEY, JSON.stringify({ ...NOTES_PERIODIC_DEFAULTS, daily: { ...NOTES_PERIODIC_DEFAULTS.daily, enabled } }));
}

function editor(): Editor {
  const dom = document.querySelector<HTMLElement & { editor?: Editor }>(".ProseMirror");
  if (!dom?.editor) throw new Error("no editor");
  return dom.editor;
}

function type(text: string): void {
  act(() => typeInto(editor(), text));
}

function press(key: string, init: KeyboardEventInit = {}): void {
  fireEvent.keyDown(editor().view.dom, { key, ...init });
}

function title(): string | null {
  return screen.getByTestId("quick-capture-title").textContent;
}

function actionsMenu(): void {
  press("k", { ctrlKey: true });
}

function menuItem(label: string): HTMLElement {
  return screen.getByRole("menuitem", { name: new RegExp(`^${label}`, "u") });
}

beforeAll(async () => {
  await loadNamespace("editor");
});

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("QuickCaptureWindow", () => {
  it("starts untitled and empty, then names itself after the first line and counts characters", async () => {
    render(<QuickCaptureWindow bridge={bridge(ok)} />);
    expect(title()).toBe(strings.untitled);
    expect(screen.getByText("0 characters")).not.toHaveAttribute("aria-live");
    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(editor().view.dom).toHaveAttribute("aria-placeholder", strings.placeholder);
    expect(editor().view.dom).toHaveAttribute("data-blank");
    expect(screen.getByRole("textbox", { name: strings.field })).toBe(editor().view.dom);
    await waitFor(() => expect(editor().isFocused).toBe(true));
    type("G");
    expect(screen.getByText("1 character")).toBeInTheDocument();
    expect(editor().view.dom).not.toHaveAttribute("data-blank");
    type("rant idea");
    expect(title()).toBe("Grant idea");
    expect(screen.getByText("10 characters")).toBeInTheDocument();
    act(() => {
      editor().commands.setContent("<h1>Lab meeting</h1><p>Move to *Thursday*</p>");
    });
    expect(title()).toBe("Lab meeting");
    expect(localStorage.getItem(DRAFT_KEY)).toBe("# Lab meeting\n\nMove to \\*Thursday\\*");
  });

  it("saves to a new note with Ctrl+Enter, then clears the draft and hides", async () => {
    const fake = bridge(ok);
    render(<QuickCaptureWindow bridge={fake} />);
    type("Grant idea");
    press("Enter", { ctrlKey: true });
    await waitFor(() => expect(fake.hide).toHaveBeenCalledTimes(1));
    expect(fake.submit).toHaveBeenCalledWith(expect.objectContaining({ text: "Grant idea", target: "new" }));
    expect(editor().getText()).toBe("");
    expect(title()).toBe(strings.untitled);
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it("adds to today's note with Shift+Ctrl+Enter only while daily notes are on", async () => {
    dailyNotes(false);
    const fake = bridge(ok);
    render(<QuickCaptureWindow bridge={fake} />);
    type("Lunch with Ana");
    press("Enter", { ctrlKey: true, shiftKey: true });
    expect(fake.submit).not.toHaveBeenCalled();
    dailyNotes(true);
    act(() => fake.show());
    press("Enter", { ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(fake.hide).toHaveBeenCalledTimes(1));
    expect(fake.submit).toHaveBeenCalledWith(expect.objectContaining({ text: "Lunch with Ana", target: "today" }));
  });

  it("lists the actions with Ctrl+K and offers today's note only while daily notes are on", async () => {
    dailyNotes(false);
    const fake = bridge(ok);
    render(<QuickCaptureWindow bridge={fake} />);
    actionsMenu();
    expect(menuItem(strings.actions.saveNew)).toHaveAttribute("data-disabled");
    expect(screen.queryByRole("menuitem", { name: new RegExp(strings.actions.saveToday, "u") })).toBeNull();
    expect(menuItem(strings.actions.copy)).toHaveAttribute("data-disabled");
    expect(menuItem(strings.actions.discard)).toHaveAttribute("data-disabled");
    actionsMenu();
    expect(screen.queryByRole("menu")).toBeNull();
    dailyNotes(true);
    act(() => fake.show());
    type("Reading list");
    actionsMenu();
    expect(menuItem(strings.actions.saveNew)).toHaveTextContent("Ctrl+Enter");
    expect(menuItem(strings.actions.saveToday)).toHaveTextContent("Ctrl+Shift+Enter");
    fireEvent.click(menuItem(strings.actions.saveToday));
    await waitFor(() => expect(fake.hide).toHaveBeenCalledTimes(1));
    expect(fake.submit).toHaveBeenCalledWith(expect.objectContaining({ text: "Reading list", target: "today" }));
  });

  it("copies the draft as Markdown and discards it from the actions", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<QuickCaptureWindow bridge={bridge(ok)} />);
    act(() => {
      editor().commands.setContent("<p><strong>Bold</strong> idea</p>");
    });
    actionsMenu();
    fireEvent.click(menuItem(strings.actions.copy));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("**Bold** idea"));
    expect(await screen.findByRole("status")).toHaveTextContent(enCommon.actions.copied);
    actionsMenu();
    fireEvent.click(menuItem(strings.actions.discard));
    expect(editor().getText()).toBe("");
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it("saves the draft as a new note with New note, then starts a blank one and stays open", async () => {
    const fake = bridge(ok);
    render(<QuickCaptureWindow bridge={fake} />);
    const plus = screen.getByRole("button", { name: strings.newNote });
    fireEvent.click(plus);
    expect(fake.submit).not.toHaveBeenCalled();
    type("First thought");
    fireEvent.click(plus);
    await waitFor(() => expect(fake.submit).toHaveBeenCalledWith(expect.objectContaining({ text: "First thought", target: "new" })));
    await waitFor(() => expect(editor().getText()).toBe(""));
    expect(fake.hide).not.toHaveBeenCalled();
    expect(editor().isEditable).toBe(true);
    await waitFor(() => expect(editor().isFocused).toBe(true));
  });

  it("hides on Escape and brings the kept draft back when shown again", () => {
    const fake = bridge(ok);
    render(<QuickCaptureWindow bridge={fake} />);
    type("Half a thought");
    press("Escape");
    expect(fake.hide).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(DRAFT_KEY)).toBe("Half a thought");
    localStorage.setItem(DRAFT_KEY, "Half a thought, finished elsewhere");
    act(() => fake.show());
    expect(editor().getText()).toBe("Half a thought, finished elsewhere");
    expect(title()).toBe("Half a thought, finished elsewhere");
  });

  it("restores a draft kept from before the window opened", () => {
    localStorage.setItem(DRAFT_KEY, "## Kept\n\n- one");
    render(<QuickCaptureWindow bridge={bridge(ok)} />);
    expect(title()).toBe("Kept");
    expect(editor().view.dom.querySelector("h2")).toHaveTextContent("Kept");
  });

  it("keeps the text and says so when saving fails", async () => {
    const fake = bridge(async (request) => ({ id: request.id, error: "disk full" }));
    render(<QuickCaptureWindow bridge={fake} />);
    type("Do not lose me");
    press("Enter", { metaKey: true });
    expect(await screen.findByRole("alert")).toHaveTextContent(strings.failed);
    expect(editor().getText()).toBe("Do not lose me");
    expect(fake.hide).not.toHaveBeenCalled();
    expect(editor().isEditable).toBe(true);
    await waitFor(() => expect(editor().isFocused).toBe(true));
  });

  it("does not save an empty capture or one still being composed", () => {
    const fake = bridge(ok);
    render(<QuickCaptureWindow bridge={fake} />);
    press("Enter", { ctrlKey: true });
    type("かな");
    press("Enter", { ctrlKey: true, isComposing: true });
    expect(fake.submit).not.toHaveBeenCalled();
  });

  it("opens the slash menu on / without items that need a note folder", () => {
    const fake = bridge(ok);
    render(<QuickCaptureWindow bridge={fake} />);
    type("/");
    const menu = screen.getByRole("listbox", { name: enNotes.blocks.slash.menu });
    expect(menu.querySelector('[data-slash-item="heading1"]')).not.toBeNull();
    expect(menu.querySelector('[data-slash-item="bookmark"]')).toBeNull();
    expect(menu.querySelector('[data-slash-item="attach"]')).toBeNull();
    press("Escape", { keyCode: 27 });
    expect(screen.queryByRole("listbox", { name: enNotes.blocks.slash.menu })).toBeNull();
    expect(fake.hide).not.toHaveBeenCalled();
    press("Escape", { keyCode: 27 });
    expect(fake.hide).toHaveBeenCalledTimes(1);
  });

  it("hides on Escape from its own buttons but not when Escape closes the actions menu", () => {
    const fake = bridge(ok);
    render(<QuickCaptureWindow bridge={fake} />);
    actionsMenu();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(fake.hide).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("button", { name: strings.openNotes }), { key: "Escape" });
    expect(fake.hide).toHaveBeenCalledTimes(1);
  });

  it("shows the controls and window buttons only once the pointer moves over the window", () => {
    const fake = bridge(ok);
    render(<QuickCaptureWindow bridge={fake} />);
    const main = screen.getByTestId("quick-capture");
    expect(main).not.toHaveAttribute("data-hovered");
    expect(fake.windowButtons).toHaveBeenLastCalledWith(false);
    fireEvent.mouseMove(document, { clientX: 40, clientY: 40 });
    fireEvent.mouseMove(document, { clientX: 40, clientY: 40 });
    expect(main).not.toHaveAttribute("data-hovered");
    fireEvent.mouseMove(document, { clientX: 44, clientY: 41 });
    expect(main).toHaveAttribute("data-hovered");
    expect(fake.windowButtons).toHaveBeenLastCalledWith(true);
    fireEvent.mouseOut(document.body, { relatedTarget: main });
    expect(main).toHaveAttribute("data-hovered");
    fireEvent.mouseOut(document.body, { relatedTarget: null });
    expect(main).not.toHaveAttribute("data-hovered");
    expect(fake.windowButtons).toHaveBeenLastCalledWith(false);
    fireEvent.mouseMove(document, { clientX: 10, clientY: 10 });
    fireEvent.mouseMove(document, { clientX: 12, clientY: 10 });
    expect(main).toHaveAttribute("data-hovered");
    act(() => fake.show());
    expect(main).not.toHaveAttribute("data-hovered");
    fireEvent.mouseMove(document, { clientX: 12, clientY: 10 });
    expect(main).not.toHaveAttribute("data-hovered");
  });

  it("opens Notes in the main window and closes from its own button", () => {
    const fake = bridge(ok);
    render(<QuickCaptureWindow bridge={fake} />);
    fireEvent.click(screen.getByRole("button", { name: strings.openNotes }));
    expect(fake.openNotes).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: enCommon.actions.close }));
    expect(fake.hide).toHaveBeenCalledTimes(1);
  });

  it("opens the floating formatting bar from T and closes it again", () => {
    render(<QuickCaptureWindow bridge={bridge(ok)} />);
    expect(screen.queryByRole("toolbar", { name: enNotes.toolbar.label })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: strings.format }));
    const toolbar = screen.getByRole("toolbar", { name: enNotes.toolbar.label });
    expect(toolbar).toHaveAttribute("data-note-toolbar-floating");
    expect(screen.queryByRole("button", { name: strings.format })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: strings.closeFormat }));
    expect(screen.queryByRole("toolbar", { name: enNotes.toolbar.label })).toBeNull();
    expect(screen.getByRole("button", { name: strings.format })).toBeInTheDocument();
  });

  it("comes back with the actions menu and the formatting bar closed", () => {
    const fake = bridge(ok);
    render(<QuickCaptureWindow bridge={fake} />);
    fireEvent.click(screen.getByRole("button", { name: strings.format }));
    actionsMenu();
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: enNotes.toolbar.label })).toBeInTheDocument();
    act(() => fake.show());
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("toolbar", { name: enNotes.toolbar.label })).toBeNull();
  });

  it("names the buttons drawn blocks carry when the pointer rests on them", async () => {
    render(<QuickCaptureWindow bridge={bridge(ok)} />);
    act(() => {
      editor().commands.setContent("<pre><code>print(1)</code></pre>");
    });
    const button = editor().view.dom.parentElement?.querySelector<HTMLElement>("[data-tooltip]");
    if (!button) throw new Error("no block button");
    fireEvent.pointerOver(button);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(button.dataset.tooltip ?? "");
  });
});
