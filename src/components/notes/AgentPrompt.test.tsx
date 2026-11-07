// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, type RefObject } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatComposerHandle } from "@/components/ai/composer/ChatComposer";
import { loadNamespace } from "@/i18n";
import enAi from "@/i18n/locales/en/ai.json" with { type: "json" };
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { useComposerDrafts } from "@/store/composer-drafts";
import { useSettingsStore } from "@/store/settings";
import type { ModelSelectorGroup } from "@/components/ai/ModelSelector";
import { AgentPrompt } from "./AgentPrompt";
import { PROMPT_COLLAPSED_KEY } from "./note-prefs";
import type { ResearchActionId } from "./types";

vi.mock("@/components/ai/composer/ChatComposer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ai/composer/ChatComposer")>();
  return {
    ...actual,
    ChatComposer: (props: Parameters<typeof actual.ChatComposer>[0]) => (
      <>
        <actual.ChatComposer {...props} />
        <button
          type="button"
          data-testid="unknown-slash"
          onClick={() => props.onSlashSelect?.({ id: "unknown", label: "Unknown" })}
        />
      </>
    ),
  };
});

vi.mock("@/components/ai/ModelSelector", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ai/ModelSelector")>();
  return {
    ...actual,
    ModelSelector: (props: Parameters<typeof actual.ModelSelector>[0]) => (
      <>
        <actual.ModelSelector {...props} />
        <button type="button" data-testid="unknown-model" onClick={() => props.onChange("acp:gone", "default")} />
      </>
    ),
  };
});

const AGENTS: ModelSelectorGroup[] = [
  { id: "acp:claude", name: "Claude Code", models: [{ id: "default", name: "Default model" }] },
  { id: "acp:codex", name: "Codex", models: [{ id: "default", name: "Default model" }] },
];
const CLAUDE = { providerId: "acp:claude", modelId: "default", label: "Claude Code" };
const WITHOUT_RUN: ReadonlySet<ResearchActionId> = new Set(["latestRun", "claims"]);
const WITH_RUN: ReadonlySet<ResearchActionId> = new Set(["claims"]);

interface Overrides {
  hiddenActions?: ReadonlySet<ResearchActionId>;
  working?: boolean;
  quote?: string | null;
  message?: string | null;
  shortcutScope?: RefObject<HTMLElement | null>;
}

function setup(overrides: Overrides = {}) {
  const onSend = vi.fn();
  const onStop = vi.fn();
  const onClearQuote = vi.fn();
  const onChoice = vi.fn();
  const composerRef = createRef<ChatComposerHandle>();
  const props = {
    composerRef,
    agents: AGENTS,
    hiddenActions: overrides.hiddenActions ?? WITHOUT_RUN,
    choice: CLAUDE,
    onChoice,
    working: overrides.working ?? false,
    quote: overrides.quote ?? null,
    message: overrides.message ?? null,
    onClearQuote,
    onSend,
    onStop,
    shortcutScope: overrides.shortcutScope,
  };
  const view = render(<AgentPrompt {...props} />);
  const rerender = (next: Overrides) => view.rerender(<AgentPrompt {...props} {...next} />);
  return { onSend, onStop, onClearQuote, onChoice, composerRef, rerender, unmount: view.unmount };
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
    expect(onSend).toHaveBeenCalledWith({ actionId: null, prompt: "Summarize run 3" });
    expect(textarea()).toHaveValue("");
  });

  it("lists the research actions when the person types a slash and runs the one they click", async () => {
    const { onSend } = setup();
    fireEvent.change(textarea(), { target: { value: "/" } });
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    const { latestRun, claims, ...offered } = enNotes.prompt.actions;
    for (const label of Object.values(offered)) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByText(latestRun)).toBeNull();
    expect(screen.queryByText(claims)).toBeNull();
    expect(screen.getByText(enNotes.prompt.actionsGroup)).toBeInTheDocument();
    fireEvent.click(screen.getByText(enNotes.prompt.actions.citations));
    expect(onSend).toHaveBeenCalledWith({ actionId: "citations", prompt: "" });
    expect(textarea()).toHaveValue("");
  });

  it("offers the latest run once there is one and still hides the claims check", async () => {
    const { onSend } = setup({ hiddenActions: WITH_RUN });
    fireEvent.change(textarea(), { target: { value: "/" } });
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    expect(screen.queryByText(enNotes.prompt.actions.claims)).toBeNull();
    fireEvent.click(screen.getByText(enNotes.prompt.actions.latestRun));
    expect(onSend).toHaveBeenCalledWith({ actionId: "latestRun", prompt: "" });
  });

  it("updates the research actions when the hidden set changes", async () => {
    const { rerender } = setup();
    rerender({ hiddenActions: WITH_RUN });
    fireEvent.change(textarea(), { target: { value: "/" } });
    expect(await screen.findByText(enNotes.prompt.actions.latestRun)).toBeInTheDocument();
  });

  it("runs the highlighted research action on Enter", async () => {
    const { onSend } = setup();
    fireEvent.change(textarea(), { target: { value: "/proofread" } });
    expect(await screen.findByRole("option", { name: enNotes.prompt.actions.proofread })).toBeInTheDocument();
    await waitFor(() =>
      expect(textarea()).toHaveAttribute("aria-activedescendant", "ai-slash-command-proofread"),
    );
    fireEvent.keyDown(textarea(), { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith({ actionId: "proofread", prompt: "" });
  });

  it("hands back the agent picked in the model menu", async () => {
    const user = userEvent.setup();
    const { onChoice } = setup();
    const trigger = screen.getByRole("combobox", { name: enAi.models.ariaLabel });
    expect(trigger).toHaveTextContent("Default model");
    await user.click(trigger);
    await user.click(await screen.findByTestId("ai-model-option-acp:codex-default"));
    expect(onChoice).toHaveBeenCalledWith({ providerId: "acp:codex", modelId: "default", label: "Codex" });
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

  it("ignores a model that is no longer offered", () => {
    const { onChoice } = setup();
    fireEvent.click(screen.getByTestId("unknown-model"));
    expect(onChoice).not.toHaveBeenCalled();
  });

  it("ignores a slash command that is not a research action", () => {
    const { onSend } = setup();
    fireEvent.click(screen.getByTestId("unknown-slash"));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("locks the model menu while the agent works", () => {
    setup({ working: true });
    expect(screen.getByRole("combobox", { name: enAi.models.ariaLabel })).toBeDisabled();
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

describe("collapsing the prompt", () => {
  interface FakeAnimation {
    element: Element;
    keyframes: Keyframe[];
    options: KeyframeAnimationOptions;
    cancel: ReturnType<typeof vi.fn>;
    finished: Promise<void>;
    finish: () => void;
    fail: () => void;
  }

  let animations: FakeAnimation[] = [];
  let scope: HTMLDivElement;

  function root() {
    return document.querySelector("[data-prompt-state]") as HTMLElement;
  }

  function parts() {
    const [morph, panel, pill] = Array.from(root().children) as HTMLElement[];
    const shell = panel.querySelector("[data-chat-composer]")?.lastElementChild as HTMLElement;
    return { morph, panel, pill, shell };
  }

  function pill() {
    return screen.getByRole("button", { name: `${enNotes.prompt.label} Claude Code` });
  }

  function collapseButton() {
    return screen.getByRole("button", { name: enNotes.prompt.collapse });
  }

  function press(init: KeyboardEventInit, target: HTMLElement = scope) {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    act(() => {
      target.dispatchEvent(event);
    });
    return event;
  }

  function withAnimations() {
    Element.prototype.animate = function animate(keyframes, options) {
      let finish = () => {};
      let fail = () => {};
      const finished = new Promise<void>((resolve, reject) => {
        finish = resolve;
        fail = () => reject(new Error("cancelled"));
      });
      const entry: FakeAnimation = {
        element: this,
        keyframes: keyframes as Keyframe[],
        options: options as KeyframeAnimationOptions,
        cancel: vi.fn(),
        finished,
        finish,
        fail,
      };
      animations.push(entry);
      return entry as unknown as Animation;
    };
  }

  function rect(element: Element, x: number, y: number, width: number, height: number) {
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue(new DOMRect(x, y, width, height));
  }

  beforeEach(() => {
    animations = [];
    scope = document.createElement("div");
    document.body.append(scope);
  });

  afterEach(() => {
    scope.remove();
    Reflect.deleteProperty(Element.prototype, "animate");
    Reflect.deleteProperty(window, "matchMedia");
    vi.restoreAllMocks();
  });

  it("starts open, collapses to a pill with the model name and remembers it", async () => {
    const user = userEvent.setup();
    setup();
    expect(root()).toHaveAttribute("data-prompt-state", "expanded");
    expect(screen.queryByRole("button", { name: `${enNotes.prompt.label} Claude Code` })).toBeNull();
    expect(collapseButton()).toHaveAttribute("aria-expanded", "true");
    await user.click(collapseButton());
    expect(root()).toHaveAttribute("data-prompt-state", "collapsed");
    expect(localStorage.getItem(PROMPT_COLLAPSED_KEY)).toBe("true");
    expect(pill()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("combobox", { name: enNotes.prompt.label })).toBeNull();
    const { panel } = parts();
    expect(panel).toHaveAttribute("inert");
    expect(panel).toHaveClass("pointer-events-none", "opacity-0");
    expect(screen.queryByRole("button", { name: enAi.composer.stop })).toBeNull();
  });

  it("opens again from the pill and puts the cursor in the box", async () => {
    const user = userEvent.setup();
    localStorage.setItem(PROMPT_COLLAPSED_KEY, "true");
    setup();
    expect(root()).toHaveAttribute("data-prompt-state", "collapsed");
    await user.click(pill());
    expect(root()).toHaveAttribute("data-prompt-state", "expanded");
    expect(localStorage.getItem(PROMPT_COLLAPSED_KEY)).toBe("false");
    expect(textarea()).toHaveFocus();
    expect(parts().pill).toHaveAttribute("inert");
  });

  it("toggles with Mod+J, collapsing only while the box is empty", () => {
    setup({ shortcutScope: { current: scope } });
    fireEvent.change(textarea(), { target: { value: "Draft" } });
    const blocked = press({ key: "j", ctrlKey: true });
    expect(blocked.defaultPrevented).toBe(true);
    expect(root()).toHaveAttribute("data-prompt-state", "expanded");
    expect(textarea()).toHaveFocus();

    fireEvent.change(textarea(), { target: { value: "   " } });
    press({ key: "J", metaKey: true });
    expect(root()).toHaveAttribute("data-prompt-state", "collapsed");

    press({ key: "j", ctrlKey: true });
    expect(root()).toHaveAttribute("data-prompt-state", "expanded");
    expect(textarea()).toHaveFocus();
  });

  it("ignores J without the modifier or with another one", () => {
    setup({ shortcutScope: { current: scope } });
    for (const init of [{ key: "j" }, { key: "j", ctrlKey: true, shiftKey: true }, { key: "j", metaKey: true, altKey: true }, { key: "k", ctrlKey: true }]) {
      expect(press(init).defaultPrevented).toBe(false);
    }
    expect(root()).toHaveAttribute("data-prompt-state", "expanded");
  });

  it("listens for Mod+J only inside its own note and stops when it closes", () => {
    const { rerender } = setup({ shortcutScope: { current: null } });
    press({ key: "j", ctrlKey: true });
    expect(root()).toHaveAttribute("data-prompt-state", "expanded");
    rerender({ shortcutScope: { current: scope } });
    press({ key: "j", ctrlKey: true });
    expect(root()).toHaveAttribute("data-prompt-state", "collapsed");
    rerender({ shortcutScope: undefined });
    press({ key: "j", ctrlKey: true });
    expect(root()).toHaveAttribute("data-prompt-state", "collapsed");
  });

  it("hands focus back to where it was when Mod+J closes the prompt", () => {
    const editor = document.createElement("button");
    document.body.append(editor);
    localStorage.setItem(PROMPT_COLLAPSED_KEY, "true");
    setup({ shortcutScope: { current: document.body } });
    act(() => editor.focus());
    press({ key: "j", metaKey: true }, editor);
    expect(textarea()).toHaveFocus();
    press({ key: "j", metaKey: true }, textarea());
    expect(root()).toHaveAttribute("data-prompt-state", "collapsed");
    expect(editor).toHaveFocus();
    editor.remove();
  });

  it("moves focus to the pill when the place it came from is gone", () => {
    const editor = document.createElement("button");
    document.body.append(editor);
    localStorage.setItem(PROMPT_COLLAPSED_KEY, "true");
    setup({ shortcutScope: { current: document.body } });
    act(() => editor.focus());
    press({ key: "j", ctrlKey: true }, editor);
    editor.remove();
    press({ key: "j", ctrlKey: true }, textarea());
    expect(pill()).toHaveFocus();
  });

  it("lands on the pill after the collapse button, which goes away", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(collapseButton());
    expect(pill()).toHaveFocus();
  });

  it("leaves focus alone when it was outside the prompt", () => {
    const editor = document.createElement("button");
    document.body.append(editor);
    setup({ shortcutScope: { current: document.body } });
    act(() => editor.focus());
    press({ key: "j", ctrlKey: true }, editor);
    expect(root()).toHaveAttribute("data-prompt-state", "collapsed");
    expect(editor).toHaveFocus();
    editor.remove();
  });

  it("shows a spinner and Stop in the pill while the agent works", async () => {
    const user = userEvent.setup();
    localStorage.setItem(PROMPT_COLLAPSED_KEY, "true");
    const { onStop, rerender } = setup();
    expect(screen.queryByRole("button", { name: enAi.composer.stop })).toBeNull();
    expect(pill().querySelector(".lucide-sparkles")).not.toBeNull();
    rerender({ working: true });
    const stop = screen.getByRole("button", { name: enAi.composer.stop });
    expect(pill().querySelector(".animate-spin")).not.toBeNull();
    await user.click(stop);
    expect(onStop).toHaveBeenCalledOnce();
    expect(root()).toHaveAttribute("data-prompt-state", "collapsed");
  });

  it("opens the prompt when the note asks to focus it and passes the other composer calls through", () => {
    localStorage.setItem(PROMPT_COLLAPSED_KEY, "true");
    const { composerRef } = setup();
    act(() => composerRef.current?.focus());
    expect(root()).toHaveAttribute("data-prompt-state", "expanded");
    expect(textarea()).toHaveFocus();
    act(() => composerRef.current?.insertText("Tighten it"));
    expect(textarea()).toHaveValue("Tighten it");
    act(() => composerRef.current?.setCaret(3));
    expect(textarea().selectionStart).toBe(3);
    expect(() => act(() => composerRef.current?.openFilePicker())).not.toThrow();
  });

  it("morphs the box into the pill: content out, shell resized, pill in, then clean up", async () => {
    withAnimations();
    const user = userEvent.setup();
    setup();
    const { morph, panel, pill: pillElement, shell } = parts();
    rect(root(), 100, 500, 800, 120);
    rect(shell, 164, 520, 672, 100);
    rect(pillElement, 660, 584, 240, 36);
    shell.style.borderTopLeftRadius = "22px";
    pillElement.style.borderTopLeftRadius = "9999px";
    await user.click(collapseButton());

    expect(animations.map((animation) => animation.element)).toEqual([panel, morph, pillElement]);
    const [out, shellMotion, arrive] = animations;
    expect(out.keyframes.map((frame) => frame.opacity)).toEqual([1, 0]);
    expect(out.options).toMatchObject({ duration: 90 });
    expect(shellMotion.keyframes).toEqual([
      { opacity: 1, transform: "translate(64px, 20px)", width: "672px", height: "100px", borderRadius: "22px" },
      { opacity: 1, transform: "translate(560px, 84px)", width: "240px", height: "36px", borderRadius: "18px" },
    ]);
    expect(shellMotion.options).toEqual({
      duration: 260,
      delay: 50,
      easing: "cubic-bezier(0.32, 0.72, 0, 1)",
      fill: "both",
    });
    expect(arrive.keyframes.map((frame) => frame.opacity)).toEqual([0, 1]);
    expect(arrive.options).toMatchObject({ delay: 230, fill: "backwards" });

    await act(async () => {
      for (const animation of animations) animation.finish();
    });
    for (const animation of animations) expect(animation.cancel).toHaveBeenCalledOnce();
  });

  it("grows from where the shell is when the person reverses mid-way", async () => {
    withAnimations();
    const user = userEvent.setup();
    setup();
    const { morph, panel, pill: pillElement } = parts();
    rect(root(), 0, 0, 800, 120);
    rect(morph, 300, 40, 400, 60);
    await user.click(collapseButton());
    const first = [...animations];
    await user.click(pill());
    for (const animation of first) expect(animation.cancel).toHaveBeenCalledOnce();
    const second = animations.slice(3);
    expect(second.map((animation) => animation.element)).toEqual([pillElement, morph, panel]);
    expect(second[1].keyframes[0]).toMatchObject({ transform: "translate(300px, 40px)", width: "400px", height: "60px" });

    await act(async () => {
      for (const animation of first) animation.finish();
    });
    for (const animation of second) expect(animation.cancel).not.toHaveBeenCalled();
    await act(async () => {
      second[0].fail();
    });
    for (const animation of second) expect(animation.cancel).not.toHaveBeenCalled();
  });

  it("snaps without motion when the person prefers reduced motion", async () => {
    withAnimations();
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    const user = userEvent.setup();
    setup();
    await user.click(collapseButton());
    expect(root()).toHaveAttribute("data-prompt-state", "collapsed");
    expect(animations).toEqual([]);
    expect(window.matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
  });

  it("animates when the media query says motion is fine", async () => {
    withAnimations();
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
    const user = userEvent.setup();
    setup();
    await user.click(collapseButton());
    expect(animations).toHaveLength(3);
  });

  it("stops a running morph when it closes", async () => {
    withAnimations();
    const user = userEvent.setup();
    const view = setup();
    await user.click(collapseButton());
    view.unmount();
    for (const animation of animations) expect(animation.cancel).toHaveBeenCalledOnce();
  });
});
