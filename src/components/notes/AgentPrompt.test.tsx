// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, type RefObject } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enAi from "@/i18n/locales/en/ai.json" with { type: "json" };
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { CollapsePromptButton, GlowRing, PromptDock, ShortcutLabel, type PromptDockHandle } from "./AgentPrompt";
import { PROMPT_COLLAPSED_KEY } from "./note-prefs";
import { useShortcutStore } from "@/store/shortcuts";

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

interface Overrides {
  working?: boolean;
  onStop?: () => void;
  shortcutScope?: RefObject<HTMLElement | null>;
}

const BOX = "Box";

function Panel({ dock }: Readonly<{ dock: RefObject<PromptDockHandle | null> }>) {
  return (
    <div className="relative">
      <div data-chat-composer>
        <span />
        <div data-testid="shell">
          <textarea aria-label={BOX} />
        </div>
      </div>
      <CollapsePromptButton onCollapse={() => dock.current?.collapse()} />
    </div>
  );
}

function setup(overrides: Overrides = {}) {
  const dock = createRef<PromptDockHandle>();
  const focusComposer = vi.fn(() => box().focus());
  const tree = (next: Overrides) => (
    <PromptDock
      handle={dock}
      detail="Built-in"
      working={next.working ?? false}
      onStop={next.onStop}
      shortcutScope={next.shortcutScope}
      focusComposer={focusComposer}
    >
      <Panel dock={dock} />
    </PromptDock>
  );
  const view = render(tree(overrides));
  return {
    dock,
    focusComposer,
    rerender: (next: Overrides) => view.rerender(tree({ ...overrides, ...next })),
    unmount: view.unmount,
  };
}

function box(): HTMLTextAreaElement {
  return screen.getByLabelText(BOX) as HTMLTextAreaElement;
}

function root() {
  return document.querySelector("[data-prompt-state]") as HTMLElement;
}

function parts() {
  const [morph, panel, pill] = Array.from(root().children) as HTMLElement[];
  const shell = panel.querySelector("[data-chat-composer]")?.lastElementChild as HTMLElement;
  return { morph, panel, pill, shell };
}

function pill() {
  return screen.getByRole("button", { name: `${enNotes.assistant.label} Built-in` });
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

beforeAll(async () => {
  await loadNamespace("notes");
});

beforeEach(() => {
  localStorage.clear();
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

describe("the assistant dock", () => {
  it("starts open, collapses to a pill naming the assistant and remembers it", async () => {
    const user = userEvent.setup();
    setup();
    expect(root()).toHaveAttribute("data-prompt-state", "expanded");
    expect(collapseButton()).toHaveAttribute("aria-expanded", "true");
    await user.click(collapseButton());
    expect(root()).toHaveAttribute("data-prompt-state", "collapsed");
    expect(localStorage.getItem(PROMPT_COLLAPSED_KEY)).toBe("true");
    expect(pill()).toHaveAttribute("aria-expanded", "false");
    const { panel } = parts();
    expect(panel).toHaveAttribute("inert");
    expect(panel).toHaveClass("pointer-events-none", "opacity-0");
    expect(screen.queryByRole("button", { name: enAi.composer.stop })).toBeNull();
  });

  it("opens again from the pill and focuses the composer", async () => {
    const user = userEvent.setup();
    localStorage.setItem(PROMPT_COLLAPSED_KEY, "true");
    const { focusComposer } = setup();
    expect(root()).toHaveAttribute("data-prompt-state", "collapsed");
    await user.click(pill());
    expect(root()).toHaveAttribute("data-prompt-state", "expanded");
    expect(localStorage.getItem(PROMPT_COLLAPSED_KEY)).toBe("false");
    expect(focusComposer).toHaveBeenCalled();
    expect(box()).toHaveFocus();
    expect(parts().pill).toHaveAttribute("inert");
  });

  it("opens and focuses through its handle, or only opens", () => {
    localStorage.setItem(PROMPT_COLLAPSED_KEY, "true");
    const { dock, focusComposer } = setup();
    act(() => dock.current?.expand(false));
    expect(root()).toHaveAttribute("data-prompt-state", "expanded");
    expect(focusComposer).not.toHaveBeenCalled();
    act(() => dock.current?.expand(true));
    expect(focusComposer).toHaveBeenCalledOnce();
    act(() => dock.current?.collapse());
    expect(root()).toHaveAttribute("data-prompt-state", "collapsed");
    act(() => dock.current?.expand(true));
    expect(box()).toHaveFocus();
  });

  it("toggles with Mod+J, collapsing only while the composer is empty", () => {
    setup({ shortcutScope: { current: scope } });
    fireEvent.change(box(), { target: { value: "Draft" } });
    const blocked = press({ key: "j", ctrlKey: true });
    expect(blocked.defaultPrevented).toBe(true);
    expect(root()).toHaveAttribute("data-prompt-state", "expanded");
    expect(box()).toHaveFocus();

    fireEvent.change(box(), { target: { value: "   " } });
    press({ key: "J", ctrlKey: true });
    expect(root()).toHaveAttribute("data-prompt-state", "collapsed");

    press({ key: "j", ctrlKey: true });
    expect(root()).toHaveAttribute("data-prompt-state", "expanded");
    expect(box()).toHaveFocus();
  });

  it("ignores J without the modifier or with another one", () => {
    setup({ shortcutScope: { current: scope } });
    for (const init of [
      { key: "j" },
      { key: "j", metaKey: true },
      { key: "j", ctrlKey: true, shiftKey: true },
      { key: "j", ctrlKey: true, altKey: true },
      { key: "k", ctrlKey: true },
    ]) {
      expect(press(init).defaultPrevented).toBe(false);
    }
    expect(root()).toHaveAttribute("data-prompt-state", "expanded");
  });

  it("uses Command on a Mac and names the shortcut the way the shortcut store does", () => {
    render(<ShortcutLabel label={enNotes.prompt.collapse} />);
    expect(screen.getByText("Ctrl+J")).toBeInTheDocument();
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    render(<ShortcutLabel label={enNotes.prompt.collapse} />);
    expect(screen.getByText("⌘J")).toBeInTheDocument();
    setup({ shortcutScope: { current: scope } });
    expect(press({ key: "j", ctrlKey: true }).defaultPrevented).toBe(false);
    expect(root()).toHaveAttribute("data-prompt-state", "expanded");
    press({ key: "j", metaKey: true });
    expect(root()).toHaveAttribute("data-prompt-state", "collapsed");
  });

  it("follows the Ask agent shortcut set in Settings", () => {
    useShortcutStore.getState().setBinding("notesAskAgent", { key: "k", mod: true, shift: true });
    try {
      render(<ShortcutLabel label={enNotes.prompt.collapse} />);
      expect(screen.getByText("Ctrl+Shift+K")).toBeInTheDocument();
      setup({ shortcutScope: { current: scope } });
      expect(press({ key: "j", ctrlKey: true }).defaultPrevented).toBe(false);
      expect(root()).toHaveAttribute("data-prompt-state", "expanded");
      press({ key: "K", ctrlKey: true, shiftKey: true });
      expect(root()).toHaveAttribute("data-prompt-state", "collapsed");
    } finally {
      useShortcutStore.getState().resetAll();
    }
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

  it("hands focus back to where it was when Mod+J closes it", () => {
    const editor = document.createElement("button");
    document.body.append(editor);
    localStorage.setItem(PROMPT_COLLAPSED_KEY, "true");
    setup({ shortcutScope: { current: document.body } });
    act(() => editor.focus());
    press({ key: "j", ctrlKey: true }, editor);
    expect(box()).toHaveFocus();
    press({ key: "j", ctrlKey: true }, box());
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
    press({ key: "j", ctrlKey: true }, box());
    expect(pill()).toHaveFocus();
  });

  it("lands on the pill after the collapse button, which goes away", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(collapseButton());
    expect(pill()).toHaveFocus();
  });

  it("leaves focus alone when it was outside the dock", () => {
    const editor = document.createElement("button");
    document.body.append(editor);
    setup({ shortcutScope: { current: document.body } });
    act(() => editor.focus());
    press({ key: "j", ctrlKey: true }, editor);
    expect(root()).toHaveAttribute("data-prompt-state", "collapsed");
    expect(editor).toHaveFocus();
    editor.remove();
  });

  it("shows a spinner and Stop in the pill while the assistant works", async () => {
    const user = userEvent.setup();
    localStorage.setItem(PROMPT_COLLAPSED_KEY, "true");
    const onStop = vi.fn();
    const { rerender } = setup({ onStop });
    expect(screen.queryByRole("button", { name: enAi.composer.stop })).toBeNull();
    expect(pill().querySelector(".lucide-sparkles")).not.toBeNull();
    rerender({ working: true });
    expect(pill().querySelector(".animate-spin")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: enAi.composer.stop }));
    expect(onStop).toHaveBeenCalledOnce();
    expect(root()).toHaveAttribute("data-prompt-state", "collapsed");
    rerender({ working: true, onStop: undefined });
    expect(screen.queryByRole("button", { name: enAi.composer.stop })).toBeNull();
  });

  it("morphs the composer into the pill: content out, shell resized, pill in, then clean up", async () => {
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

  it("stops a running morph when it closes", async () => {
    withAnimations();
    const user = userEvent.setup();
    const view = setup();
    await user.click(collapseButton());
    view.unmount();
    for (const animation of animations) expect(animation.cancel).toHaveBeenCalledOnce();
  });
});

describe("the working glow", () => {
  const css = readFileSync(join(process.cwd(), "src/components/notes/notes.css"), "utf8");

  it("spins a gradient layer with a transform instead of repainting a custom property", () => {
    expect(css).not.toContain("@property --note-glow-angle");
    expect(css).not.toMatch(/--note-glow-angle:\s*360deg/u);
    expect(css).toMatch(/@keyframes note-glow-spin \{\n {2}to \{\n {4}transform: translate\(-50%, -50%\) rotate\(360deg\);/u);
    expect(css).toContain(".note-prompt-glow[data-working] > .note-prompt-glow-ring::before {\n  animation: note-glow-spin");
    expect(css).toContain("@media (prefers-reduced-motion: reduce) {\n  .note-prompt-glow[data-working] > .note-prompt-glow-ring::before {\n    animation: none;");
  });

  it("draws the ring as a hidden layer", () => {
    render(<GlowRing />);
    const ring = document.querySelector("[data-glow-ring]");
    expect(ring).toHaveClass("note-prompt-glow-ring");
    expect(ring).toHaveAttribute("aria-hidden", "true");
  });
});
