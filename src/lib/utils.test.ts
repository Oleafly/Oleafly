import { describe, expect, it } from "vitest";
import { shortcut } from "@/lib/utils";

// The second arg forces the platform so the test doesn't depend on the ambient
// navigator (which the test host reports as Mac). On macOS `shortcut` is
// identity, which is what e2e relies on (it runs in the macOS WKWebView and
// selects buttons by aria-labels that keep the ⌘ glyphs).
describe("shortcut", () => {
  it("converts mac modifier glyphs to Ctrl/Shift words off Mac", () => {
    expect(shortcut("⌘↵", false)).toBe("Ctrl+Enter");
    expect(shortcut("⌘⇧F", false)).toBe("Ctrl+Shift+F");
    expect(shortcut("⌘⇧Z", false)).toBe("Ctrl+Shift+Z");
    expect(shortcut("⌘K", false)).toBe("Ctrl+K");
    expect(shortcut("⌘/", false)).toBe("Ctrl+/");
    expect(shortcut("⇧F12", false)).toBe("Shift+F12");
  });

  it("is identity on Mac", () => {
    expect(shortcut("⌘↵", true)).toBe("⌘↵");
    expect(shortcut("⌘⇧F", true)).toBe("⌘⇧F");
  });

  it("leaves strings without mac glyphs unchanged", () => {
    expect(shortcut("F12", false)).toBe("F12");
    expect(shortcut("Tab", false)).toBe("Tab");
    expect(shortcut("Ctrl-Space", false)).toBe("Ctrl-Space");
  });
});
