import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  convertLatexMath,
  convertLatexMathInText,
  findLatexMathSpans,
  latexMathToTypst,
} from "./latex-to-typst-math";

const GOLDEN: ReadonlyArray<readonly [string, string]> = [
  [String.raw`\frac{a}{b}`, "frac(a, b)"],
  [String.raw`\frac12`, "frac(1, 2)"],
  [String.raw`\dfrac{x+1}{y}`, "frac(x+1, y)"],
  [String.raw`\tfrac{1}{n}`, "frac(1, n)"],
  [String.raw`\sqrt{x}`, "sqrt(x)"],
  [String.raw`\sqrt[3]{x}`, "root(3, x)"],
  [String.raw`\sqrt{x^2 + y^2}`, "sqrt(x^2 + y^2)"],
  [String.raw`\sqrt{\frac{a}{b}}`, "sqrt(frac(a, b))"],
  ["x^2", "x^2"],
  ["x^{10}", "x^10"],
  ["x^{n+1}", "x^(n+1)"],
  ["x_{i,j}", "x_(i,j)"],
  ["x_i^2", "x_i^2"],
  ["x^2_i", "x_i^2"],
  [String.raw`e^{i\pi}`, "e^(i pi)"],
  ["a_{n-1}", "a_(n-1)"],
  ["10^{-3}", "10^(-3)"],
  [String.raw`\alpha + \beta = \gamma`, "alpha + beta = gamma"],
  [String.raw`\Gamma(n)`, "Gamma(n)"],
  [String.raw`\Delta x`, "Delta x"],
  [String.raw`\epsilon \varepsilon`, "epsilon.alt epsilon"],
  [String.raw`\phi \varphi`, "phi.alt phi"],
  [String.raw`\vartheta \varrho \varsigma`, "theta.alt rho.alt sigma.alt"],
  [String.raw`\sin x + \cos(y)`, "sin x + cos(y)"],
  [String.raw`\log_2 n`, "log_2 n"],
  [String.raw`\lim_{x \to 0} \frac{\sin x}{x} = 1`, "lim_(x -> 0) frac(sin x, x) = 1"],
  [String.raw`\sum_{i=1}^{n} i`, "sum_(i=1)^n i"],
  [String.raw`\prod_{k=1}^{n} k`, "product_(k=1)^n k"],
  [String.raw`\int_0^\infty e^{-x^2}\,dx`, "integral_0^infinity e^(-x^2) thin d x"],
  [String.raw`\int\limits_a^b f`, "limits(integral)_a^b f"],
  [String.raw`\sum\nolimits_i`, "scripts(sum)_i"],
  [String.raw`\oint_C \iint \iiint`, "integral.cont_C integral.double integral.triple"],
  [String.raw`\int_{a}^{b} f(x) \, \mathrm{d}x`, "integral_a^b f(x) thin upright(d) x"],
  [String.raw`\left( \frac{a}{b} \right)`, "(frac(a, b))"],
  [String.raw`\left[ x \right]`, "[x]"],
  [String.raw`\left\{ x \right\}`, "{x}"],
  [String.raw`\left| x \right|`, "abs(x)"],
  [String.raw`\left\| x \right\|`, "norm(x)"],
  [String.raw`\left. \frac{df}{dx} \right|_{x=0}`, "lr(frac(d f, d x) |)_(x=0)"],
  [String.raw`\left\langle x, y \right\rangle`, "⟨x, y⟩"],
  [String.raw`\left( x \middle| y \right)`, "(x mid(|) y)"],
  [String.raw`\left( x \right)^2`, "(x)^2"],
  [String.raw`\left. x \right\}`, String.raw`lr(x \})`],
  [String.raw`\begin{pmatrix} a & b \\ c & d \end{pmatrix}`, "mat(a, b; c, d)"],
  [String.raw`\begin{bmatrix} 1 & 0 \\ 0 & 1 \end{bmatrix}`, `mat(delim: "[", 1, 0; 0, 1)`],
  [String.raw`\begin{vmatrix} a & b \\ c & d \end{vmatrix}`, `mat(delim: "|", a, b; c, d)`],
  [String.raw`\begin{Vmatrix} a \end{Vmatrix}`, `mat(delim: "‖", a)`],
  [String.raw`\begin{Bmatrix} a \end{Bmatrix}`, `mat(delim: "{", a)`],
  [String.raw`\begin{matrix} a & b \end{matrix}`, "mat(delim: #none, a, b)"],
  [String.raw`\begin{pmatrix} 1 & 2 \\ 3 & 4 \\ \end{pmatrix}`, "mat(1, 2; 3, 4)"],
  [String.raw`\left(\begin{array}{cc} 1 & 2 \\ 3 & 4 \end{array}\right)`, "(mat(delim: #none, 1, 2; 3, 4))"],
  [
    String.raw`f(x) = \begin{cases} x^2 & x \ge 0 \\ -x & x < 0 \end{cases}`,
    "f(x) = cases(x^2 & quad x >= 0, -x & quad x < 0)",
  ],
  [
    String.raw`\begin{cases} 1 & \text{if } x > 0 \\ 0 & \text{otherwise} \end{cases}`,
    `cases(1 & quad "if " x > 0, 0 & quad "otherwise")`,
  ],
  [String.raw`\begin{rcases} a \\ b \end{rcases}`, "cases(reverse: #true, a, b)"],
  [String.raw`\begin{aligned} a &= b \\ &= c \end{aligned}`, "a &= b \\\n&= c"],
  [String.raw`\begin{align*} x &= 1 \\ y &= 2 \end{align*}`, "x &= 1 \\\ny &= 2"],
  [String.raw`\begin{gather} a \\ b \end{gather}`, "a \\\nb"],
  [String.raw`\begin{equation} E = mc^2 \label{eq:e} \end{equation}`, "E = m c^2"],
  [String.raw`\text{area} = \pi r^2`, `"area" = pi r^2`],
  [String.raw`\text{for all } x`, `"for all " x`],
  [String.raw`\text{if $x>0$}`, `"if " x > 0`],
  [String.raw`\mathbb{R}`, "bb(R)"],
  [String.raw`\mathbb{N} \subset \mathbb{Z}`, "bb(N) subset bb(Z)"],
  [String.raw`\mathcal{L}`, "cal(L)"],
  [String.raw`\mathfrak{g} \mathscr{F}`, "frak(g) scr(F)"],
  [String.raw`\mathbf{x}`, "bold(upright(x))"],
  [String.raw`\boldsymbol{\alpha}`, "bold(alpha)"],
  [String.raw`\mathrm{d}x`, "upright(d) x"],
  [String.raw`\mathrm{max}`, `upright("max")`],
  [String.raw`\mathrm{e}^{x}`, "upright(e)^x"],
  [String.raw`\operatorname{rank}(A)`, `op("rank")(A)`],
  [String.raw`\operatorname*{arg\,max}_x`, `op("arg max", limits: #true)_x`],
  [String.raw`\hat{x}`, "hat(x)"],
  [String.raw`\widehat{xy}`, "hat(x y)"],
  [String.raw`\bar{x}`, "macron(x)"],
  [String.raw`\overline{AB}`, "overline(A B)"],
  [String.raw`\vec{v}`, "arrow(v)"],
  [String.raw`\dot{x} + \ddot{x}`, "dot(x) + dot.double(x)"],
  [String.raw`\tilde{a}`, "tilde(a)"],
  [String.raw`\hat{\imath}`, "hat(dotless.i)"],
  [String.raw`\underbrace{a+b}_{n}`, "underbrace(a+b, n)"],
  [String.raw`\overbrace{x+y}^{\text{sum}}`, `overbrace(x+y, "sum")`],
  [String.raw`\binom{n}{k}`, "binom(n, k)"],
  [String.raw`\binom{n}{k} = \frac{n!}{k!\,(n-k)!}`, "binom(n, k) = frac(n!, k! thin (n-k)!)"],
  [String.raw`a \leq b \geq c \neq d`, "a <= b >= c != d"],
  [String.raw`a \le b \ne c`, "a <= b != c"],
  [String.raw`x \in A \subseteq B`, "x in A subset.eq B"],
  [String.raw`x \notin A`, "x in.not A"],
  [String.raw`A \cup B \cap C`, "A union B ∩ C"],
  [String.raw`A \setminus B`, "A without B"],
  [String.raw`\forall x \exists y`, "forall x exists y"],
  [String.raw`p \Rightarrow q \iff r`, "p => q <==> r"],
  [String.raw`p \implies q`, "p ==> q"],
  [String.raw`a \cdot b \times c`, "a dot.op b times c"],
  [String.raw`\pm 1`, "plus.minus 1"],
  [String.raw`1, 2, \ldots, n`, "1, 2, dots.h, n"],
  [String.raw`a_1 + \cdots + a_n`, "a_1 + dots.c + a_n"],
  [String.raw`\vdots \ddots`, "dots.v dots.down"],
  [String.raw`\infty`, "infinity"],
  [String.raw`\partial f / \partial x`, String.raw`partial f \/ partial x`],
  [String.raw`a/b`, String.raw`a\/b`],
  [String.raw`\nabla \cdot \mathbf{F}`, "nabla dot.op bold(upright(F))"],
  ["f'(x)", "f'(x)"],
  ["f''(x)", "f''(x)"],
  [String.raw`x^\prime`, "x'"],
  [String.raw`\{ x \mid x > 0 \}`, "{x divides x > 0}"],
  [String.raw`\{a, b\}`, "{a, b}"],
  [String.raw`\langle x, y \rangle`, "⟨x, y⟩"],
  [String.raw`\lfloor x \rfloor`, "⌊x⌋"],
  [String.raw`\lVert x \rVert`, "‖x‖"],
  [String.raw`a \quad b \qquad c`, "a quad b wide c"],
  [String.raw`a\,b\;c\!d`, "a thin b thick c d"],
  [String.raw`50\%`, "50%"],
  [String.raw`a \& b`, String.raw`a \& b`],
  [String.raw`x \mapsto x^2`, "x |-> x^2"],
  [String.raw`x \to y`, "x -> y"],
  [String.raw`\overset{!}{=}`, "limits(=)^!"],
  [String.raw`\stackrel{\text{def}}{=}`, `limits(=)^"def"`],
  [String.raw`\underset{x}{\arg\min}`, "limits(arg min)_x"],
  [String.raw`\cancel{x}`, "cancel(x)"],
  [String.raw`\boxed{E=mc^2}`, "#box(stroke: 0.5pt, inset: 2pt, $E=m c^2$)"],
  [String.raw`a = b \tag{1}`, "a = b"],
  [String.raw`\label{eq:1} a = b \nonumber`, "a = b"],
  [String.raw`\displaystyle \sum_i x_i`, "display(sum_i x_i)"],
  [String.raw`\frac{a,b}{c}`, String.raw`frac(a\,b, c)`],
  [String.raw`\frac{a;b}{c}`, String.raw`frac(a\;b, c)`],
  [String.raw`\frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`, "frac(-b plus.minus sqrt(b^2 - 4 a c), 2 a)"],
  ["[0, 1)", "[0, 1)"],
  [String.raw`\frac{[0,1)}{2}`, "frac([0,1), 2)"],
  [String.raw`\frac{(a}{b}`, String.raw`frac(\(a, b)`],
  [String.raw`\frac{|a,b|}{2}`, String.raw`frac(|a\,b|, 2)`],
  [String.raw`\hbar\omega`, "ℏ omega"],
  [String.raw`\xrightarrow{f}`, "limits(-->)^f"],
  [String.raw`x \equiv y \pmod{n}`, "x equiv y quad (mod n)"],
  [String.raw`a \bmod b`, "a mod b"],
  [String.raw`\sum_{\substack{i<n \\ j<m}} a_{ij}`, String.raw`sum_(i < n \ j < m) a_(i j)`],
  [String.raw`\textcolor{red}{x+1}`, "#text(fill: red, $x+1$)"],
  [String.raw`\not\in`, "in.not"],
  [String.raw`a \not= b`, "a != b"],
  [String.raw`x \approx y \sim z`, "x approx y tilde.op z"],
  [String.raw`a \ll b \gg c`, "a << b >> c"],
  [String.raw`a \oplus b \otimes c`, "a ⊕ b ⊗ c"],
  [String.raw`\bigcup_{i} A_i`, "union.big_i A_i"],
  ["a % comment\n + b", "a + b"],
  [String.raw`a \\ b`, String.raw`a \ b`],
  [String.raw`\mathbf{0}`, "bold(upright(0))"],
  [String.raw`\#\$\_`, String.raw`\#\$\_`],
  [String.raw`\text{"quoted"}`, String.raw`"\"quoted\""`],
  ["{}_{n}C_{k}", `""_n C_k`],
  [String.raw`\vec{x}\cdot\vec{y}`, "arrow(x) dot.op arrow(y)"],
  [String.raw`\Pr(A \mid B)`, "Pr(A divides B)"],
];

describe("latexMathToTypst", () => {
  it("covers at least sixty golden cases", () => {
    expect(GOLDEN.length).toBeGreaterThanOrEqual(60);
  });

  it.each(GOLDEN)("converts %s", (latex, typst) => {
    expect(latexMathToTypst(latex)).toBe(typst);
  });

  it("lists commands it has no Typst equivalent for", () => {
    const result = convertLatexMath(String.raw`\foo + \alpha + \ce{H2O}`);
    expect(result.unsupported).toEqual([String.raw`\foo`, String.raw`\ce`]);
    expect(result.typst).toBe(`foo + alpha + "H2O"`);
  });

  it("uses the older name for the partial sign before Typst 0.12", () => {
    expect(latexMathToTypst(String.raw`\partial f`, { typstVersion: "0.11.1" })).toBe("diff f");
    expect(latexMathToTypst(String.raw`\partial f`, { typstVersion: "0.13.1" })).toBe("partial f");
  });

  it("uses calligraphic letters for script letters before Typst 0.13", () => {
    expect(latexMathToTypst(String.raw`\mathscr{F}`, { typstVersion: "0.12.0" })).toBe("cal(F)");
  });

  it("returns an empty string for empty input", () => {
    expect(latexMathToTypst("   ")).toBe("");
  });

  it("survives unbalanced input without throwing", () => {
    for (const input of ["\\frac{a", "x^", "\\left( x", "a}", "\\begin{pmatrix} a", "\\right)", "\\end{cases}"]) {
      expect(() => latexMathToTypst(input)).not.toThrow();
    }
  });
});

describe("findLatexMathSpans", () => {
  it("finds inline and display spans with their delimiters", () => {
    const text = String.raw`Let $x^2$ and \(y\) then $$a$$ and \[b\] end \begin{align}c\end{align}.`;
    expect(findLatexMathSpans(text).map((span) => [text.slice(span.from, span.to), span.display])).toEqual([
      ["$x^2$", false],
      [String.raw`\(y\)`, false],
      ["$$a$$", true],
      [String.raw`\[b\]`, true],
      [String.raw`\begin{align}c\end{align}`, true],
    ]);
  });

  it("skips escaped dollars and unclosed spans", () => {
    expect(findLatexMathSpans(String.raw`costs \$5 and $x`)).toEqual([]);
  });
});

describe("convertLatexMathInText", () => {
  it("converts each span and keeps the prose", () => {
    expect(convertLatexMathInText(String.raw`where $\alpha_i$ is \[\frac{1}{2}\] done`)).toEqual({
      text: "where $alpha_i$ is $ frac(1, 2) $ done",
      count: 2,
    });
  });

  it("converts a pasted align environment to display math", () => {
    expect(
      convertLatexMathInText(String.raw`\begin{align} a &= b \\ c &= d \end{align}`).text,
    ).toBe("$ a &= b \\\nc &= d $");
  });

  it("leaves text without LaTeX math alone", () => {
    expect(convertLatexMathInText("plain text")).toEqual({ text: "plain text", count: 0 });
  });
});

function bundledTypst(): string | null {
  const triples: Record<string, string> = {
    "darwin-arm64": "aarch64-apple-darwin",
    "darwin-x64": "x86_64-apple-darwin",
    "linux-arm64": "aarch64-unknown-linux-gnu",
    "linux-x64": "x86_64-unknown-linux-gnu",
    "win32-x64": "x86_64-pc-windows-msvc",
  };
  const triple = triples[`${process.platform}-${process.arch}`];
  if (!triple) return null;
  const binary = path.resolve(
    __dirname,
    "../../../src-tauri/binaries",
    `typst-${triple}${process.platform === "win32" ? ".exe" : ""}`,
  );
  return existsSync(binary) ? binary : null;
}

const TYPST = bundledTypst();

function compileTypst(source: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), "oleafly-latex-to-typst-"));
  try {
    writeFileSync(path.join(directory, "main.typ"), source);
    const result = spawnSync(
      TYPST as string,
      ["compile", "main.typ", "main.svg", "--root", directory, "--diagnostic-format", "short"],
      { cwd: directory, timeout: 60_000, encoding: "utf8" },
    );
    const log = `${result.stderr ?? ""}${result.stdout ?? ""}`;
    return result.status === 0 ? log : log || "error: typst failed";
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe.skipIf(!TYPST)("converted math compiles with the bundled Typst", () => {
  it("compiles every golden output without errors or warnings", () => {
    const page = "#set page(width: auto, height: auto)\n";
    const all = compileTypst(page + GOLDEN.map(([, typst]) => `$ ${typst} $\n`).join("\n"));
    const failures: string[] = [];
    if (/error|warning/u.test(all)) {
      for (const [latex, typst] of GOLDEN) {
        const log = compileTypst(`${page}$ ${typst} $\n`);
        if (/error|warning/u.test(log)) failures.push(`${latex} -> ${typst}\n${log}`);
      }
    }
    expect(failures).toEqual([]);
  }, 120_000);

  it("compiles converted inline and display spans", () => {
    const text = String.raw`Let $\alpha_i \in \mathbb{R}$ and \[\sum_{i=1}^n \frac{1}{i^2} \le \frac{\pi^2}{6}\]`;
    const converted = convertLatexMathInText(text).text;
    expect(compileTypst(`#set page(width: auto, height: auto)\n${converted}\n`)).not.toMatch(/error|warning/u);
  }, 60_000);
});
