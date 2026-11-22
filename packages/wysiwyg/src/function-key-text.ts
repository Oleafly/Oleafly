// AppKit reserves U+F700-U+F747 for function keys (NSUpArrowFunctionKey to NSModeSwitchFunctionKey in NSEvent.h),
// and the arrow keys also carry their Carbon character codes 0x1C-0x1F (kLeftArrowCharCode to kDownArrowCharCode).
// WKWebView can hand either to the page as typed text; U+F8FF (the Apple logo) is real text and stays outside both ranges.
const FUNCTION_KEY_CHAR = /[\u{1C}-\u{1F}\u{F700}-\u{F747}]/u;
const FUNCTION_KEY_CHARS = /[\u{1C}-\u{1F}\u{F700}-\u{F747}]/gu;
const ONLY_FUNCTION_KEYS = /^[\u{1C}-\u{1F}\u{F700}-\u{F747}]+$/u;

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
