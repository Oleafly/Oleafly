import { EditorView, ViewPlugin, drawSelection } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type { ViewUpdate } from "@codemirror/view";
import { nativeCursorLayer } from "./cursor-height";

export const EDITOR_CURSOR_BLINKING = ["blink", "smooth", "phase", "expand", "off"] as const;

export type EditorCursorBlinking = (typeof EDITOR_CURSOR_BLINKING)[number];

type AnimatedBlinking = Exclude<EditorCursorBlinking, "blink" | "off">;

const RESTART_CLASSES = ["cm-cursorBlink-a", "cm-cursorBlink-b"] as const;

type ThemeSpec = Parameters<typeof EditorView.theme>[0];

const KEYFRAMES: Record<AnimatedBlinking, ThemeSpec[string]> = {
  smooth: { "0%, 20%": { opacity: 1 }, "60%, 100%": { opacity: 0 } },
  phase: { "0%, 20%": { opacity: 1 }, "90%, 100%": { opacity: 0 } },
  expand: { "0%, 20%": { transform: "scaleY(1)" }, "80%, 100%": { transform: "scaleY(0)" } },
};

function isAnimated(style: EditorCursorBlinking): style is AnimatedBlinking {
  return style !== "blink" && style !== "off";
}

function animationTheme(style: AnimatedBlinking): Extension {
  const rules: ThemeSpec = {};
  RESTART_CLASSES.forEach((restart, index) => {
    const name = `oleafly-cursor-${style}-${index}`;
    rules[`@keyframes ${name}`] = KEYFRAMES[style];
    rules[`&.cm-focused > .cm-scroller > .cm-cursorLayer.${restart} .cm-cursor`] = {
      animation: `${name} 0.5s ease-in-out 0s 20 alternate`,
      willChange: style === "expand" ? "transform" : "opacity",
    };
  });
  return EditorView.theme(rules);
}

const restartOnSelection = ViewPlugin.fromClass(
  class {
    restart = 0;
    layer: HTMLElement | null = null;

    constructor(readonly view: EditorView) {
      this.apply();
    }

    update(update: ViewUpdate) {
      if (update.transactions.some((transaction) => transaction.selection)) {
        this.restart = 1 - this.restart;
        this.apply();
      } else if (!this.layer?.isConnected) {
        this.apply();
      }
    }

    apply() {
      const layer = nativeCursorLayer(this.view);
      if (!layer) return;
      const next = RESTART_CLASSES[this.restart];
      if (layer === this.layer && layer.classList.contains(next)) return;
      layer.classList.remove(...RESTART_CLASSES);
      layer.classList.add(next);
      this.layer = layer;
    }

    destroy() {
      this.layer?.classList.remove(...RESTART_CLASSES);
    }
  },
);

const ANIMATION_THEMES: Record<AnimatedBlinking, Extension> = {
  smooth: animationTheme("smooth"),
  phase: animationTheme("phase"),
  expand: animationTheme("expand"),
};

export function cursorBlinking(style: EditorCursorBlinking): Extension {
  return [
    drawSelection(style === "blink" ? {} : { cursorBlinkRate: 0 }),
    isAnimated(style) ? [ANIMATION_THEMES[style], restartOnSelection] : [],
  ];
}
