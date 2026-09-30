// Key values that never name a shortcut key: modifiers and lock keys on
// their own, dead and compose keys, IME mode and layout-switch keys, and keys
// the layout cannot identify. IME mode keys report a different value as the
// IME changes state (Hankaku or Zenkaku), so a binding on them would only
// fire some of the time.
const UNBINDABLE_KEYS = new Set([
  "Alt",
  "AltGraph",
  "CapsLock",
  "Control",
  "Fn",
  "FnLock",
  "Hyper",
  "Meta",
  "NumLock",
  "OS",
  "ScrollLock",
  "Shift",
  "Super",
  "Symbol",
  "SymbolLock",
  "Compose",
  "Dead",
  "GroupFirst",
  "GroupLast",
  "GroupNext",
  "GroupPrevious",
  "ModeChange",
  "Process",
  "Unidentified",
  "Accept",
  "AllCandidates",
  "Alphanumeric",
  "CodeInput",
  "Convert",
  "NonConvert",
  "FinalMode",
  "NextCandidate",
  "PreviousCandidate",
  "SingleCandidate",
  "HangulMode",
  "HanjaMode",
  "JunjaMode",
  "Eisu",
  "Hankaku",
  "Zenkaku",
  "ZenkakuHankaku",
  "Hiragana",
  "Katakana",
  "HiraganaKatakana",
  "KanaMode",
  "KanjiMode",
  "Romaji",
]);

export function isUnbindableKey(key: string): boolean {
  return UNBINDABLE_KEYS.has(key);
}

// Named key values such as ArrowUp, F5 or Enter. Any other key value is text
// the layout typed, which can be longer than one code point.
const NAMED_KEY = /^[A-Z][A-Za-z0-9]+$/;
const PRINTABLE_ASCII = /^[\x21-\x7e]$/;

function platform(): string {
  return typeof navigator !== "undefined" ? (navigator.platform ?? "") : "";
}

// True when the key types a character through the layout's AltGr or Option
// level, such as "@" from AltGr+Q on a German layout, so it is text and not a
// shortcut.
//
// Windows: AltGr is Ctrl+Alt. It arrives with AltGraph set and Ctrl and Alt
// either both set or both clear, and holding Ctrl as well still types the
// character. A real Ctrl+Alt+Q on a US layout has key "q" and no AltGraph.
// Linux: WebKitGTK reports AltGraph from 2.54 and never sets Ctrl or Alt for
// AltGr. Ctrl+AltGr types nothing there, so it stays a shortcut.
// macOS: WKWebView never reports AltGraph. Option alone with a key that types
// plain ASCII, such as Option+L for "@" on a German layout, is text. The US
// Option level only types other characters (∂, ®), so those stay bindable.
export function isAltGraphCharacter(event: KeyboardEvent): boolean {
  if (!event.key || NAMED_KEY.test(event.key)) return false;
  const os = platform();
  if (/Mac|iPhone|iPad/.test(os)) {
    return (
      event.altKey && !event.ctrlKey && !event.metaKey && PRINTABLE_ASCII.test(event.key)
    );
  }
  if (typeof event.getModifierState !== "function" || !event.getModifierState("AltGraph")) {
    return false;
  }
  return os.startsWith("Win") || (!event.ctrlKey && !event.metaKey);
}
