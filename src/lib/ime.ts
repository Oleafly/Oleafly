import type { KeyboardEvent as ReactKeyboardEvent } from "react";

type KeyLike = { isComposing?: boolean; keyCode?: number };

function composing(event: KeyLike | null | undefined): boolean {
  return Boolean(event && (event.isComposing === true || event.keyCode === 229));
}

/**
 * True for the key event that confirms an IME composition (Japanese,
 * Chinese, Korean input), which must never send a message. WebKit reports
 * that Enter with `isComposing` false and `keyCode` 229, so both count.
 * Accepts DOM and React events, and the partial objects tests pass.
 */
export function isImeEnter(event: KeyboardEvent | ReactKeyboardEvent): boolean {
  const own = event as KeyLike & { nativeEvent?: KeyLike };
  return composing(own) || composing(own.nativeEvent);
}
