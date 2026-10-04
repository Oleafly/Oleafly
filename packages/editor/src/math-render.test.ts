// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MathDelimiter, MathExpression } from "./math-source";
import { mountMathPreview, renderMathExpression, renderMathSource } from "./math-render";
import { setEditorTranslator } from "./messages";

// The visible part of the KaTeX output. The MathML annotation keeps the TeX
// source, so a label key or a \ref command shows up there by design.
function visible(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content.querySelector(".katex-html")?.textContent ?? "";
}

describe("renderMathExpression", () => {
  it.each([
    ["an equation", String.raw`\begin{equation} a = b \label{eq:ab} \end{equation}`, true],
    ["each align row", String.raw`\begin{align}a &= b \label{eq:a}\\ c &= d \label{eq:c}\end{align}`, true],
    ["a gather row", String.raw`\begin{gather}a = b \label{eq:a}\end{gather}`, true],
    ["a Markdown display body", String.raw`a = b \label{eq:ab}`, true],
    ["inline math", String.raw`a \label{eq:ab} = b`, false],
    ["a key with a space before it", String.raw`a = b \label {eq:ab}`, true],
    ["a key with odd characters", String.raw`a = b \label{eq:x_1#~é}`, true],
  ])("renders %s that carries a \\label", (_name, body, display) => {
    const result = renderMathExpression(body, display);
    expect(result.message ?? null).toBeNull();
    expect(result.status).toBe("ready");
    expect(visible(result.html)).not.toContain("eq:");
  });

  it("drops a cleveref label type along with the key", () => {
    const result = renderMathExpression(String.raw`a = b \label[lemma]{eq:ab}`, true);
    expect(result.status).toBe("ready");
    expect(visible(result.html)).toBe("a=b");
  });

  it("keeps \\nonumber and \\notag working", () => {
    for (const body of [
      String.raw`\begin{align}a &= b \nonumber \\ c &= d \notag\end{align}`,
      String.raw`a = b \notag`,
    ]) {
      expect(renderMathExpression(body, true).status).toBe("ready");
    }
  });

  it("renders a reference inside math as a placeholder", () => {
    const eqref = renderMathExpression(String.raw`a = b \quad \text{by } \eqref{eq:ab}`, true);
    expect(eqref.status).toBe("ready");
    expect(visible(eqref.html)).toContain("(??)");
    expect(visible(eqref.html)).not.toContain("eq:ab");

    for (const body of [
      String.raw`\ref{eq:ab}`,
      String.raw`\ref*{eq:ab}`,
      String.raw`\pageref{eq:ab}`,
      String.raw`\autoref{eq:ab}`,
      String.raw`\nameref{eq:ab}`,
      String.raw`\cref{eq:a,eq:b}`,
      String.raw`\Cref{eq:ab}`,
      String.raw`\text{see \ref{eq:x_1}}`,
    ]) {
      const result = renderMathExpression(body, false);
      expect(result.status, body).toBe("ready");
      expect(visible(result.html), body).toContain("??");
      expect(visible(result.html), body).not.toContain("eq:");
    }
  });

  it("renders multline, which KaTeX lacks, as centred rows", () => {
    for (const environment of ["multline", "multline*"]) {
      const result = renderMathExpression(
        String.raw`\begin{${environment}} a + b \\ \shoveleft{+ c} \\ \shoveright{= d} \end{${environment}}`,
        true,
      );
      expect(result.message ?? null, environment).toBeNull();
      expect(visible(result.html)).toContain("d");
    }
  });

  it("still rejects commands KaTeX does not know and a label without a key", () => {
    expect(renderMathExpression(String.raw`\undefinedcommand`, false).status).toBe("error");
    expect(renderMathExpression(String.raw`a \label`, false).status).toBe("error");
  });

  it("does not carry a \\gdef from one render into the next", () => {
    expect(renderMathExpression(String.raw`\gdef\leaked{X} a`, false).status).toBe("ready");
    expect(renderMathExpression(String.raw`\leaked`, false).status).toBe("error");
    expect(renderMathExpression(String.raw`\gdef\label#1{LEAK} a`, false).status).toBe("ready");
    const after = renderMathExpression(String.raw`a \label{eq:after}`, false);
    expect(after.status).toBe("ready");
    expect(visible(after.html)).toBe("a");
  });
});

describe("renderMathSource", () => {
  it.each([
    ["eqnarray", String.raw`a &=& b \label{eq:a} \\ c &=& d`],
    ["eqnarray*", String.raw`a &=& b \\ c &=& d`],
    ["flalign", String.raw`a &= b & c &= d \label{eq:a}`],
    ["displaymath", String.raw`a = b`],
    ["math", String.raw`a = b`],
    ["multline", String.raw`a + b \\ = c \label{eq:a}`],
  ])("renders the %s environment, which KaTeX lacks", (environment, body) => {
    const result = renderMathSource(String.raw`\begin{${environment}}${body}\end{${environment}}`, true);
    expect(result.message ?? null).toBeNull();
    expect(result.status).toBe("ready");
    expect(visible(result.html)).not.toContain("eq:");
  });

  it("renders a labelled numbered environment without a number", () => {
    const result = renderMathSource(
      String.raw`\begin{align}a &= b \label{eq:a} \\ c &= d \label{eq:c}\end{align}`,
      true,
    );
    expect(result.status).toBe("ready");
    expect(result.html).not.toContain("katex-tag");
  });

  it("renders a bare body unchanged", () => {
    expect(renderMathSource("x^2", false)).toEqual(renderMathExpression("x^2", false));
  });
});

describe("renderMathExpression limits", () => {
  it("refuses empty and oversized input", () => {
    expect(renderMathExpression("   ", false)).toEqual({ status: "error", html: "", message: "math.empty" });
    expect(renderMathExpression("x".repeat(8_193), false)).toMatchObject({ status: "error", message: "math.tooLong" });
  });

  it("refuses output that would be too large to show", () => {
    expect(renderMathExpression(String.raw`\sqrt{x}`.repeat(1_000), true)).toMatchObject({
      status: "error",
      message: "math.outputTooLarge",
    });
  });

  it("serves repeated renders from the cache until older entries are evicted", () => {
    const first = renderMathExpression("q_{cached}", false);
    expect(renderMathExpression("q_{cached}", false)).toBe(first);
    for (let index = 0; index < 170; index += 1) renderMathExpression(`q_{${index}}`, false);
    const again = renderMathExpression("q_{cached}", false);
    expect(again).not.toBe(first);
    expect(again).toEqual(first);
  });

  it("keeps colour styling and drops presentation attributes KaTeX output does not need", () => {
    const colored = renderMathExpression(String.raw`\textcolor{red}{x}`, false);
    expect(colored.html).toContain("color:red");
    const boxed = renderMathExpression(String.raw`\boxed{x}`, false);
    expect(boxed.status).toBe("ready");
    expect(boxed.html).not.toContain("notation=");
  });
});

function expression(overrides: Partial<MathExpression> = {}): MathExpression {
  return {
    from: 0,
    to: 3,
    bodyFrom: 1,
    bodyTo: 2,
    source: "$x$",
    body: "x",
    display: false,
    delimiter: "$",
    status: "complete",
    ...overrides,
  };
}

describe("mountMathPreview", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("paints on the next tick without an intersection observer and not after it is destroyed", () => {
    vi.useFakeTimers();
    const host = document.createElement("span");
    mountMathPreview(host, { expression: expression(), identity: "1", isCurrent: () => true });
    expect(host.querySelector(".math-preview-loading")?.textContent).toBe("math.previewing");
    vi.runAllTimers();
    expect(host.querySelector(".katex")).not.toBeNull();
    const second = document.createElement("span");
    mountMathPreview(second, { expression: expression(), identity: "1", isCurrent: () => true }).destroy();
    vi.runAllTimers();
    expect(second.querySelector(".katex")).toBeNull();
  });

  it("paints once the host scrolls into view and shares one observer", () => {
    const callbacks: Array<(entries: Array<{ isIntersecting: boolean; target: Element }>) => void> = [];
    const observe = vi.fn();
    const unobserve = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: (entries: Array<{ isIntersecting: boolean; target: Element }>) => void) {
          callbacks.push(callback);
        }
        observe = observe;
        unobserve = unobserve;
        disconnect = disconnect;
      },
    );
    const first = document.createElement("span");
    const second = document.createElement("span");
    mountMathPreview(first, { expression: expression(), identity: "1", isCurrent: () => true });
    mountMathPreview(second, { expression: expression({ body: "y" }), identity: "1", isCurrent: () => true });
    expect(callbacks).toHaveLength(1);
    expect(observe).toHaveBeenCalledTimes(2);
    callbacks[0]([{ isIntersecting: false, target: first }]);
    expect(first.querySelector(".katex")).toBeNull();
    callbacks[0]([{ isIntersecting: true, target: first }]);
    expect(first.querySelector(".katex")).not.toBeNull();
    expect(unobserve).toHaveBeenCalledWith(first);
    expect(disconnect).not.toHaveBeenCalled();
    callbacks[0]([{ isIntersecting: true, target: second }]);
    expect(second.querySelector(".katex")).not.toBeNull();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("stops observing a destroyed preview and disconnects when none remain", () => {
    const disconnect = vi.fn();
    const unobserve = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve = unobserve;
        disconnect = disconnect;
      },
    );
    const host = document.createElement("span");
    mountMathPreview(host, { expression: expression(), identity: "1", isCurrent: () => true }).destroy();
    expect(unobserve).toHaveBeenCalledWith(host);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("shows the reason an expression cannot be shown", () => {
    const failed = document.createElement("span");
    mountMathPreview(failed, {
      expression: expression({ body: String.raw`\undefinedcommand` }),
      identity: "1",
      isCurrent: () => true,
      eager: true,
    });
    expect(failed.querySelector(".math-preview-output")?.classList.contains("is-error")).toBe(true);
    expect(failed.querySelector(".math-preview-error")?.getAttribute("role")).toBe("status");
    expect(failed.textContent).toContain("undefinedcommand");
    setEditorTranslator((key, params) => `${key} ${params?.delimiter ?? ""}`.trim());
    try {
      const pairs: [MathDelimiter, string][] = [
        ["$", "$"],
        [String.raw`\(` as MathDelimiter, String.raw`\)`],
        [String.raw`\[` as MathDelimiter, String.raw`\]`],
      ];
      for (const [delimiter, closing] of pairs) {
        const host = document.createElement("span");
        const onPaint = vi.fn();
        mountMathPreview(host, {
          expression: expression({ status: "incomplete", delimiter }),
          identity: "1",
          isCurrent: () => true,
          eager: true,
          onPaint,
        });
        expect(host.querySelector(".math-preview-error")?.textContent).toBe(`math.missingClosing ${closing}`);
        expect(onPaint).toHaveBeenCalledWith(expect.objectContaining({ status: "error" }));
      }
    } finally {
      setEditorTranslator(null);
    }
  });

  it("labels the preview with a shortened copy of a long body", () => {
    const body = "a".repeat(300);
    const host = document.createElement("span");
    mountMathPreview(host, { expression: expression({ body, display: true }), identity: "1", isCurrent: () => true, eager: true });
    expect(host.getAttribute("aria-label")).toBe(`Display math preview: ${"a".repeat(239)}…`);
    expect(host.classList.contains("is-display")).toBe(true);
  });

  it("does not paint for a stale revision or a reused host", () => {
    const stale = document.createElement("span");
    mountMathPreview(stale, { expression: expression(), identity: "1", isCurrent: () => false, eager: true });
    expect(stale.querySelector(".math-preview-loading")).not.toBeNull();
    vi.useFakeTimers();
    const reused = document.createElement("span");
    mountMathPreview(reused, { expression: expression(), identity: "1", isCurrent: () => true });
    reused.dataset.mathPreviewIdentity = "2";
    vi.runAllTimers();
    expect(reused.querySelector(".katex")).toBeNull();
  });
});
