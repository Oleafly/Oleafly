import { EditorView } from "@codemirror/view";
import {
  functionKeyTextOffsets,
  hasFunctionKeyText,
  onlyFunctionKeyText,
  withoutFunctionKeyText,
} from "@oleafly/wysiwyg/function-key-text";
import { logError } from "@/lib/log";

type TextField = HTMLInputElement | HTMLTextAreaElement;

function refuseFunctionKeyText(event: Event): void {
  const { data, inputType } = event as InputEvent;
  if (inputType && !inputType.startsWith("insert")) return;
  if (data && onlyFunctionKeyText(data)) event.preventDefault();
}

function textFieldOf(target: EventTarget | null): TextField | null {
  if (!(target instanceof Element)) return null;
  if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") return null;
  const field = target as TextField;
  return typeof field.selectionStart === "number" ? field : null;
}

function setFieldValue(field: TextField, value: string): void {
  const owner = Object.getPrototypeOf(field) as object;
  const setter = Object.getOwnPropertyDescriptor(owner, "value")?.set;
  if (setter) setter.call(field, value);
  else field.value = value;
}

function shiftedBy(offsets: readonly number[], position: number | null): number | null {
  if (position === null) return null;
  return position - offsets.filter((offset) => offset < position).length;
}

function clearFunctionKeyText(field: TextField): boolean {
  const offsets = functionKeyTextOffsets(field.value);
  if (offsets.length === 0) return false;
  const start = shiftedBy(offsets, field.selectionStart);
  const end = shiftedBy(offsets, field.selectionEnd);
  const direction = field.selectionDirection ?? undefined;
  setFieldValue(field, withoutFunctionKeyText(field.value));
  if (start !== null && end !== null) field.setSelectionRange(start, end, direction);
  return true;
}

export function installFunctionKeyTextGuard(windowObject: Window = window): () => void {
  let reported = false;
  const clearField = (event: Event) => {
    if ((event as InputEvent).isComposing) return;
    const field = textFieldOf(event.target);
    if (!field || !clearFunctionKeyText(field)) return;
    if (reported) return;
    reported = true;
    void logError("function key text reached a field past beforeinput", (event as InputEvent).inputType || event.type);
  };
  windowObject.addEventListener("beforeinput", refuseFunctionKeyText, true);
  windowObject.addEventListener("textInput", refuseFunctionKeyText, true);
  windowObject.addEventListener("input", clearField, true);
  windowObject.addEventListener("compositionend", clearField, true);
  return () => {
    windowObject.removeEventListener("beforeinput", refuseFunctionKeyText, true);
    windowObject.removeEventListener("textInput", refuseFunctionKeyText, true);
    windowObject.removeEventListener("input", clearField, true);
    windowObject.removeEventListener("compositionend", clearField, true);
  };
}

export const functionKeyTextInput = EditorView.inputHandler.of((view, from, to, text) => {
  if (!hasFunctionKeyText(text)) return false;
  const kept = withoutFunctionKeyText(text);
  if (kept) {
    view.dispatch({
      changes: { from, to, insert: kept },
      selection: { anchor: from + kept.length },
      userEvent: "input.type",
      scrollIntoView: true,
    });
  }
  return true;
});
