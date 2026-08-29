// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createPreviewTypingEcho } from "./typingEcho";

const COLORS = { ink: "#111", paper: "#fff" };

function makeSpan(text: string): HTMLElement {
  const span = document.createElement("span");
  span.textContent = text;
  document.body.appendChild(span);
  return span;
}

describe("createPreviewTypingEcho", () => {
  it("places a caret at the offset and echoes typed characters before it", () => {
    const span = makeSpan("hello world");
    const echo = createPreviewTypingEcho({ span, offset: 5 }, COLORS);
    expect(echo).not.toBeNull();
    echo?.insert(",");
    echo?.insert(" y");
    expect(span.textContent).toBe("hello, y world");
    const caret = span.querySelector("[data-pdf-typing-caret]");
    expect(caret).not.toBeNull();
    expect(caret?.previousSibling?.textContent).toBe("hello, y");
  });

  it("removes the character before the caret on backspace and stops at the segment start", () => {
    const span = makeSpan("ab cd");
    const echo = createPreviewTypingEcho({ span, offset: 2 }, COLORS);
    expect(echo?.backspace()).toBe(true);
    expect(echo?.backspace()).toBe(true);
    expect(echo?.backspace()).toBe(false);
    expect(span.textContent).toBe(" cd");
  });

  it("makes the span visible on the first edit only", () => {
    const span = makeSpan("abc");
    const echo = createPreviewTypingEcho({ span, offset: 3 }, COLORS);
    expect(span.style.color).toBe("");
    echo?.insert("x");
    expect(span.style.color).toBe("rgb(17, 17, 17)");
    expect(span.style.backgroundColor).toBe("rgb(255, 255, 255)");
  });

  it("keeps echoed text but removes the caret on dispose", () => {
    const span = makeSpan("abc");
    const echo = createPreviewTypingEcho({ span, offset: 3 }, COLORS);
    echo?.insert("d");
    echo?.dispose();
    expect(span.querySelector("[data-pdf-typing-caret]")).toBeNull();
    expect(span.textContent).toBe("abcd");
    expect(echo?.isConnected()).toBe(false);
  });

  it("reports disconnection after the text layer is rebuilt", () => {
    const span = makeSpan("abc");
    const echo = createPreviewTypingEcho({ span, offset: 1 }, COLORS);
    span.remove();
    expect(echo?.isConnected()).toBe(false);
    echo?.insert("x");
    expect(span.textContent).toBe("abc");
  });

  it("returns null for a span without a text node", () => {
    const span = document.createElement("span");
    expect(createPreviewTypingEcho({ span, offset: 0 }, COLORS)).toBeNull();
  });

  it("clamps an out-of-range offset to the text length", () => {
    const span = makeSpan("abc");
    const echo = createPreviewTypingEcho({ span, offset: 99 }, COLORS);
    echo?.insert("d");
    expect(span.textContent).toBe("abcd");
  });
});
