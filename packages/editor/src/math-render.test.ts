// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderMathExpression, renderMathSource } from "./math-render";

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
