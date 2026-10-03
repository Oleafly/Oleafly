// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/editor/cm/controller", () => ({ insertAtCursor: vi.fn() }));

import { SYMBOL_CATEGORIES } from "./SymbolPicker";
import {
  TYPST_SYMBOLS,
  typstGlyphSpec,
  typstSymbolForLatex,
  typstSymbolInsertion,
  typstSymbolLabel,
  typstSymbolName,
  typstSymbolText,
  type TypstInsertContext,
} from "./typst-symbols";

const TYPST_0_15_SYMBOLS: Readonly<Record<string, string>> = {
  "CC": "ℂ", "Delta": "Δ", "Gamma": "Γ", "Im": "ℑ", "Lambda": "Λ", "NN": "ℕ", "Omega": "Ω",
  "Phi": "Φ", "Pi": "Π", "Psi": "Ψ", "QQ": "ℚ", "RR": "ℝ", "Re": "ℜ", "Sigma": "Σ", "Theta": "Θ",
  "Upsilon": "Υ", "Xi": "Ξ", "ZZ": "ℤ", "aleph": "א", "alpha": "α", "amp": "&", "and": "∧",
  "angle": "∠", "approx": "≈", "arrow.b": "↓", "arrow.b.double": "⇓", "arrow.bl": "↙",
  "arrow.br": "↘", "arrow.l": "←", "arrow.l.double": "⇐", "arrow.l.hook": "↩", "arrow.l.long": "⟵",
  "arrow.l.r": "↔", "arrow.l.r.double": "⇔", "arrow.l.r.double.long": "⟺", "arrow.r": "→",
  "arrow.r.bar": "↦", "arrow.r.double": "⇒", "arrow.r.double.long": "⟹", "arrow.r.hook": "↪",
  "arrow.r.long": "⟶", "arrow.r.long.bar": "⟼", "arrow.t": "↑", "arrow.t.double": "⇑",
  "arrow.tl": "↖", "arrow.tr": "↗", "ast.op": "∗", "bar.v": "|", "bar.v.double": "‖",
  "because": "∵", "beta": "β", "bot": "⊥", "brace.l": "{", "brace.r": "}", "bracket.l": "[",
  "bracket.r": "]", "bullet": "•", "ceil.l": "⌈", "ceil.r": "⌉", "chevron.l": "⟨",
  "chevron.r": "⟩", "chi": "χ", "compose": "∘", "dagger": "†", "dagger.double": "‡", "degree": "°",
  "delta": "δ", "diamond.stroked.small": "⋄", "div": "÷", "divides": "∣", "dollar": "$",
  "dot.o": "⊙", "dot.op": "⋅", "dots.down": "⋱", "dots.h": "…", "dots.h.c": "⋯", "dots.v": "⋮",
  "ell": "ℓ", "emptyset": "∅", "epsilon": "ε", "epsilon.alt": "ϵ", "eq": "=", "eq.not": "≠",
  "equiv": "≡", "eta": "η", "exists": "∃", "exists.not": "∄", "floor.l": "⌊", "floor.r": "⌋",
  "forall": "∀", "gamma": "γ", "gt": ">", "gt.double": "≫", "gt.eq": "≥", "harpoon.lt": "↼",
  "harpoon.rt": "⇀", "harpoons.rtlb": "⇌", "hash": "#", "in": "∈", "in.not": "∉", "in.rev": "∋",
  "infinity": "∞", "integral": "∫", "integral.cont": "∮", "integral.double": "∬",
  "integral.triple": "∭", "inter": "∩", "inter.big": "⋂", "iota": "ι", "kappa": "κ", "lambda": "λ",
  "lozenge.stroked": "◊", "lt": "<", "lt.double": "≪", "lt.eq": "≤", "minus": "−", "minus.o": "⊖",
  "minus.plus": "∓", "models": "⊧", "mu": "μ", "nabla": "∇", "not": "¬", "nu": "ν", "omega": "ω",
  "or": "∨", "parallel": "∥", "paren.l": "(", "paren.r": ")", "partial": "∂", "percent": "%",
  "perp": "⟂", "phi": "φ", "phi.alt": "ϕ", "pi": "π", "pi.alt": "ϖ", "planck": "ħ", "plus": "+",
  "plus.minus": "±", "plus.o": "⊕", "prec": "≺", "prec.eq": "⪯", "product": "∏", "product.co": "∐",
  "prop": "∝", "psi": "ψ", "rho": "ρ", "rho.alt": "ϱ", "sigma": "σ", "sigma.alt": "ς",
  "square.stroked": "□", "star.op": "⋆", "subset": "⊂", "subset.eq": "⊆", "succ": "≻",
  "succ.eq": "⪰", "suit.club": "♣", "suit.diamond.stroked": "♢", "suit.heart.stroked": "♡",
  "suit.spade": "♠", "sum": "∑", "supset": "⊃", "supset.eq": "⊇", "tack.r": "⊢", "tau": "τ",
  "therefore": "∴", "theta": "θ", "theta.alt": "ϑ", "tilde.eq": "≃", "tilde.equiv": "≅",
  "tilde.op": "∼", "times": "×", "times.o": "⊗", "top": "⊤", "triangle.stroked.t": "△",
  "union": "∪", "union.big": "⋃", "upsilon": "υ", "without": "∖", "xi": "ξ", "zeta": "ζ",
};

const LEGACY_SYMBOLS: Readonly<Record<string, string>> = {
  "angle.l": "⟨", "angle.r": "⟩", "plus.circle": "⊕", "minus.circle": "⊖", "times.circle": "⊗",
  "dot.circle": "⊙", sect: "∩", "sect.big": "⋂", "planck.reduce": "ℏ",
};

const SEMANTIC_CODEPOINTS: Readonly<Record<string, string>> = {
  "\\perp": "⟂",
  "\\models": "⊧",
  "\\hbar": "ħ",
  "\\aleph": "א",
};

const PICKER = SYMBOL_CATEGORIES.flatMap((category) => category.items);

function spec(latex: string) {
  const found = typstSymbolForLatex(latex);
  if (!found) throw new Error(`no Typst symbol for ${latex}`);
  return found;
}

function insert(latex: string, context: TypstInsertContext, before = "", after = "", version: string | null = null) {
  return typstSymbolInsertion(spec(latex), context, version, before, after).insert;
}

describe("typst symbol table", () => {
  it("maps every symbol the picker shows", () => {
    const missing = PICKER.filter((symbol) => !TYPST_SYMBOLS.has(symbol.latex)).map((symbol) => symbol.latex);
    expect(missing).toEqual([]);
  });

  it("names a Typst 0.15 symbol that renders the glyph the picker shows", () => {
    for (const symbol of PICKER) {
      const entry = spec(symbol.latex);
      const name = typstSymbolName(entry, "0.15.1");
      if (name === null) continue;
      expect(TYPST_0_15_SYMBOLS[name], `${symbol.latex} -> ${name}`).toBeDefined();
      const expected = SEMANTIC_CODEPOINTS[symbol.latex] ?? symbol.char;
      expect(TYPST_0_15_SYMBOLS[name], `${symbol.latex} -> ${name}`).toBe(expected);
    }
  });

  it("produces math, markup and code text for every picker entry", () => {
    for (const symbol of PICKER) {
      for (const context of ["math", "markup", "code", "string"] as const) {
        const text = typstSymbolText(spec(symbol.latex), context, null, symbol.char);
        expect(text.text.length, `${symbol.latex} in ${context}`).toBeGreaterThan(0);
        expect(text.from).toBeGreaterThanOrEqual(0);
        expect(text.to).toBeLessThanOrEqual(text.text.length);
        if (context !== "math") expect(text.text, symbol.latex).not.toMatch(/^\\[A-Za-z]/u);
      }
    }
  });

  it("writes names in math, the sym module in markup and code", () => {
    expect(insert("\\alpha", "math")).toBe("alpha");
    expect(insert("\\alpha", "markup")).toBe("#sym.alpha");
    expect(insert("\\alpha", "code")).toBe("sym.alpha");
    expect(insert("\\rightarrow", "math")).toBe("arrow.r");
    expect(insert("\\rightarrow", "markup")).toBe("#sym.arrow.r");
    expect(insert("\\sum", "math")).toBe("sum");
    expect(insert("\\epsilon", "math")).toBe("epsilon.alt");
    expect(insert("\\varepsilon", "math")).toBe("epsilon");
    expect(insert("\\phi", "math")).toBe("phi.alt");
    expect(insert("\\varphi", "math")).toBe("phi");
    expect(insert("\\mathbb{R}", "math")).toBe("RR");
    expect(insert("\\mathbb{R}", "markup")).toBe("#sym.RR");
  });

  it("keeps plain characters in math and escapes text in markup", () => {
    expect(insert("+", "math")).toBe("+");
    expect(insert("+", "markup")).toBe("#sym.plus");
    expect(insert("-", "math")).toBe("-");
    expect(insert("(", "math")).toBe("(");
    expect(insert("\\{", "math")).toBe("{");
    expect(insert("\\#", "markup")).toBe("\\#");
    expect(insert("\\#", "math")).toBe("hash");
    expect(insert("\\%", "markup")).toBe("%");
    expect(insert("\\&", "math")).toBe("amp");
  });

  it("wraps math functions in an equation outside math and selects the placeholder", () => {
    const math = typstSymbolInsertion(spec("\\frac{}{}"), "math", null, "", "");
    expect(math).toEqual({ insert: "frac(a, b)", from: 5, to: 6 });
    const markup = typstSymbolInsertion(spec("\\frac{}{}"), "markup", null, "", "");
    expect(markup).toEqual({ insert: "$frac(a, b)$", from: 6, to: 7 });
    expect(insert("\\sqrt{}", "math")).toBe("sqrt(x)");
    expect(insert("\\vec{}", "math")).toBe("arrow(x)");
    expect(insert("\\bar{}", "math")).toBe("macron(x)");
    expect(insert("\\check{}", "math")).toBe("caron(x)");
    expect(insert("\\mathbf{}", "markup")).toBe("$bold(x)$");
    expect(insert("\\text{}", "math")).toBe('"text"');
    expect(insert("\\left( \\right)", "math")).toBe("lr(( x ))");
    expect(insert("\\sin", "math")).toBe("sin");
    expect(insert("\\sin", "markup")).toBe("$sin$");
  });

  it("writes math spacing names and markup horizontal space", () => {
    expect(insert("\\quad", "math")).toBe("quad");
    expect(insert("\\quad", "markup")).toBe("#h(1em)");
    expect(insert("\\qquad", "math")).toBe("wide");
    expect(insert("\\,", "math")).toBe("thin");
    expect(insert("\\;", "math")).toBe("thick");
    expect(insert("\\!", "math")).toBe("#h(-1em / 6)");
  });

  it("separates identifiers from neighbouring letters", () => {
    expect(insert("\\alpha", "math", "x", "y")).toBe(" alpha ");
    expect(insert("\\alpha", "math", "x", "2")).toBe(" alpha ");
    expect(insert("\\alpha", "math", "_", "")).toBe("alpha");
    expect(insert("\\alpha", "math", " ", "^")).toBe("alpha");
    expect(insert("\\frac{}{}", "math", "x", "")).toBe(" frac(a, b)");
    expect(insert("\\alpha", "markup", "a", "b")).toBe("#sym.alpha;");
    expect(insert("\\alpha", "markup", "a", " ")).toBe("#sym.alpha");
    expect(insert("\\alpha", "markup", "a", ".")).toBe("#sym.alpha;");
    expect(insert("\\wp", "math", "x", "y")).toBe(" ℘ ");
    const spaced = typstSymbolInsertion(spec("\\alpha"), "math", null, "x", "y");
    expect(spaced.from).toBe(spaced.insert.length);
  });

  it("uses names the project's Typst version knows", () => {
    expect(insert("\\langle", "math", "", "", "0.15.1")).toBe("chevron.l");
    expect(insert("\\langle", "math", "", "", "0.13.1")).toBe("angle.l");
    expect(insert("\\oplus", "math", "", "", "0.14.2")).toBe("plus.o");
    expect(insert("\\oplus", "markup", "", "", "0.13.1")).toBe("#sym.plus.circle");
    expect(insert("\\cap", "math", "", "", "0.13.1")).toBe("inter");
    expect(insert("\\cap", "math", "", "", "0.12.0")).toBe("sect");
    expect(insert("\\bigcap", "code", "", "", "0.12.0")).toBe("sym.sect.big");
    expect(insert("\\hbar", "math", "", "", "0.14.2")).toBe("planck");
    expect(insert("\\hbar", "math", "", "", "0.13.1")).toBe("planck.reduce");
    expect(insert("\\lfloor", "math", "", "", "0.11.1")).toBe("⌊");
    expect(insert("\\lfloor", "markup", "", "", "0.11.1")).toBe("⌊");
    expect(insert("\\heartsuit", "markup", "", "", "0.11.1")).toBe("♡");
    expect(insert("\\heartsuit", "markup", "", "", "0.12.0")).toBe("#sym.suit.heart.stroked");
    expect(insert("\\langle", "math", "", "", null)).toBe("chevron.l");
  });

  it("only falls back to names that older Typst releases define", () => {
    for (const symbol of PICKER) {
      const entry = spec(symbol.latex);
      for (const version of ["0.11.1", "0.12.0", "0.13.1"]) {
        const name = typstSymbolName(entry, version);
        if (name === null || name === typstSymbolName(entry, null)) continue;
        expect(LEGACY_SYMBOLS[name], `${symbol.latex} on ${version} -> ${name}`).toBe(symbol.char);
      }
    }
  });

  it("labels symbols by their Typst name and falls back to glyphs for unknown commands", () => {
    expect(typstSymbolLabel("\\alpha", null)).toBe("alpha");
    expect(typstSymbolLabel("\\langle", "0.13.1")).toBe("angle.l");
    expect(typstSymbolLabel("\\frac{}{}", null)).toBe("frac(a, b)");
    expect(typstSymbolLabel("\\unknowncommand", null)).toBeNull();
    expect(typstSymbolForLatex("\\to")).toBe(typstSymbolForLatex("\\rightarrow"));
    const glyph = typstGlyphSpec("⊛");
    expect(typstSymbolInsertion(glyph, "math", null, "", "").insert).toBe("⊛");
    expect(typstSymbolInsertion(glyph, "markup", null, "", "").insert).toBe("⊛");
    expect(typstSymbolInsertion(typstGlyphSpec("*"), "markup", null, "", "").insert).toBe("\\*");
  });

  it("inserts the glyph inside strings and comments", () => {
    const alpha = typstSymbolInsertion(spec("\\alpha"), "string", null, "", "", "α");
    expect(alpha.insert).toBe("α");
    const frac = typstSymbolInsertion(spec("\\frac{}{}"), "comment", null, "", "", "a/b");
    expect(frac.insert).toBe("a/b");
  });
});
