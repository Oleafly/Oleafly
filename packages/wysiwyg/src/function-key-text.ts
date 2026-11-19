// AppKit reserves U+F700-U+F747 for function keys (NSUpArrowFunctionKey to NSModeSwitchFunctionKey in NSEvent.h).
// WKWebView can hand them to the page as typed text; U+F8FF (the Apple logo) is real text and stays outside the range.
const FUNCTION_KEY_CHAR = /[-]/u;
const FUNCTION_KEY_CHARS = /[-]/gu;
const ONLY_FUNCTION_KEYS = /^[-]+$/u;

export function hasFunctionKeyText(text: string): boolean {
  return FUNCTION_KEY_CHAR.test(text);
}

export function onlyFunctionKeyText(text: string): boolean {
  return ONLY_FUNCTION_KEYS.test(text);
}

export function functionKeyTextOffsets(text: string): number[] {
  return Array.from(text.matchAll(FUNCTION_KEY_CHARS), (match) => match.index);
}

export function withoutFunctionKeyText(text: string): string {
  return text.replaceAll(FUNCTION_KEY_CHARS, "");
}
