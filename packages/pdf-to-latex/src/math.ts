const SYM: Record<string, string> = {
  "α": "\\alpha",
  "β": "\\beta",
  "γ": "\\gamma",
  "δ": "\\delta",
  "ε": "\\epsilon",
  "ζ": "\\zeta",
  "η": "\\eta",
  "θ": "\\theta",
  "ι": "\\iota",
  "κ": "\\kappa",
  "λ": "\\lambda",
  "μ": "\\mu",
  "ν": "\\nu",
  "ξ": "\\xi",
  "π": "\\pi",
  "ρ": "\\rho",
  "σ": "\\sigma",
  "τ": "\\tau",
  "υ": "\\upsilon",
  "φ": "\\phi",
  "χ": "\\chi",
  "ψ": "\\psi",
  "ω": "\\omega",
  "Γ": "\\Gamma",
  "Δ": "\\Delta",
  "Θ": "\\Theta",
  "Λ": "\\Lambda",
  "Ξ": "\\Xi",
  "Π": "\\Pi",
  "Σ": "\\Sigma",
  "Φ": "\\Phi",
  "Ψ": "\\Psi",
  "Ω": "\\Omega",
  "∑": "\\sum",
  "∏": "\\prod",
  "∫": "\\int",
  "∮": "\\oint",
  "∂": "\\partial",
  "∇": "\\nabla",
  "∞": "\\infty",
  "≤": "\\le",
  "≥": "\\ge",
  "≠": "\\ne",
  "≈": "\\approx",
  "≡": "\\equiv",
  "±": "\\pm",
  "∓": "\\mp",
  "×": "\\times",
  "÷": "\\div",
  "·": "\\cdot",
  "→": "\\to",
  "←": "\\leftarrow",
  "⇒": "\\Rightarrow",
  "⇐": "\\Leftarrow",
  "↦": "\\mapsto",
  "∈": "\\in",
  "∉": "\\notin",
  "⊂": "\\subset",
  "⊆": "\\subseteq",
  "∪": "\\cup",
  "∩": "\\cap",
  "∀": "\\forall",
  "∃": "\\exists",
  "¬": "\\neg",
  "∧": "\\wedge",
  "∨": "\\vee",
  "√": "\\surd",
  "∝": "\\propto",
  "∅": "\\emptyset",
  "ℝ": "\\mathbb{R}",
  "ℕ": "\\mathbb{N}",
  "ℤ": "\\mathbb{Z}",
  "¹": "^{1}",
  "²": "^{2}",
  "³": "^{3}",
  "°": "^{\\circ}",
};

const SYM_CLASS = `[${Object.keys(SYM).join("")}]`;
const SYM_RE = new RegExp(SYM_CLASS, "u");
const SYM_RE_G = new RegExp(SYM_CLASS, "gu");

/** Words safe to pull into an adjacent math run. Prose words stay out. */
function isMathWord(w: string): boolean {
  if (SYM_RE.test(w)) return true;
  if (w.length === 1) return true;
  if (/^[0-9=+\-/^_(){}.,]+$/.test(w)) return true;
  return /^[a-zA-Z][0-9_^]+$/.test(w);
}

export function mathifyText(escaped: string): { text: string; inlineCount: number } {
  if (!SYM_RE.test(escaped)) return { text: escaped, inlineCount: 0 };
  const words = escaped.split(" ").filter((w) => w.length > 0);
  const out: string[] = [];
  let inlineCount = 0;
  let i = 0;
  while (i < words.length) {
    if (SYM_RE.test(words[i])) {
      let start = i;
      let end = i;
      while (start > 0 && out.length > 0 && isMathWord(words[start - 1])) {
        start--;
        out.pop();
      }
      while (end + 1 < words.length && isMathWord(words[end + 1])) end++;
      const run = words
        .slice(start, end + 1)
        .join(" ")
        .replace(SYM_RE_G, (c) => `${SYM[c]} `)
        .replace(/\s+/g, " ")
        .trim();
      out.push(`$${run}$`);
      inlineCount++;
      i = end + 1;
    } else {
      out.push(words[i]);
      i++;
    }
  }
  return { text: out.join(" "), inlineCount };
}

export function isDisplayMathLine(text: string): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > 120) return false;
  const symbols = (t.match(SYM_RE_G) ?? []).length + (t.match(/[=+^]/g) ?? []).length;
  return symbols >= 3 && symbols / t.replace(/\s/g, "").length > 0.12;
}

export function stripMathDelimiters(text: string): string {
  return text.replace(/\$/g, "");
}
