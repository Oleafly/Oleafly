import {
  createPreviewTypingEcho,
  snapAfterWord,
  type PreviewTextTarget,
  type PreviewTypingEcho,
} from "@oleafly/preview/typingEcho";
import { getEditorView } from "@/components/editor/cm/controller";

const INK = "#18181b";
const PAPER = "#ffffff";

interface ActiveTyping {
  echo: PreviewTypingEcho;
  removeListeners: () => void;
}

let active: ActiveTyping | null = null;

export function isPreviewTypingArmed(): boolean {
  return active !== null;
}

export function disarmPreviewTyping() {
  if (!active) return;
  const current = active;
  active = null;
  current.removeListeners();
  current.echo.dispose();
}

function editorHasFocus(): boolean {
  return getEditorView()?.hasFocus ?? false;
}

function handleKeyDown(event: KeyboardEvent) {
  const current = active;
  if (!current) return;
  if (!current.echo.isConnected() || !editorHasFocus()) {
    disarmPreviewTyping();
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) {
    disarmPreviewTyping();
    return;
  }
  if (event.key === "Backspace") {
    current.echo.backspace();
    return;
  }
  if (event.key.length === 1) {
    current.echo.insert(event.key);
    return;
  }
  if (event.key === "Shift" || event.key === "CapsLock") return;
  disarmPreviewTyping();
}

function handleMouseDown(event: MouseEvent) {
  const target = event.target;
  if (target instanceof Element && target.closest(".textLayer")) return;
  disarmPreviewTyping();
}

export function armPreviewTyping(target: PreviewTextTarget): boolean {
  disarmPreviewTyping();
  const view = getEditorView();
  if (!view) return false;
  const selection = view.state.selection.main;
  if (!selection.empty) {
    view.dispatch({ selection: { anchor: selection.to } });
  }
  const text = target.span.textContent ?? "";
  const echo = createPreviewTypingEcho(
    { span: target.span, offset: snapAfterWord(text, target.offset) },
    { ink: INK, paper: PAPER },
  );
  if (!echo) return false;
  window.addEventListener("keydown", handleKeyDown, true);
  window.addEventListener("mousedown", handleMouseDown, true);
  active = {
    echo,
    removeListeners: () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("mousedown", handleMouseDown, true);
    },
  };
  return true;
}
