const SYM: Record<string, string> = {
  "α": String.raw`\alpha`,
  "β": String.raw`\beta`,
  "γ": String.raw`\gamma`,
  "δ": String.raw`\delta`,
  "ε": String.raw`\epsilon`,
  "ζ": String.raw`\zeta`,
  "η": String.raw`\eta`,
  "θ": String.raw`\theta`,
  "ι": String.raw`\iota`,
  "κ": String.raw`\kappa`,
  "λ": String.raw`\lambda`,
  "μ": String.raw`\mu`,
  "ν": String.raw`\nu`,
  "ξ": String.raw`\xi`,
  "π": String.raw`\pi`,
  "ρ": String.raw`\rho`,
  "σ": String.raw`\sigma`,
  "τ": String.raw`\tau`,
  "υ": String.raw`\upsilon`,
  "φ": String.raw`\phi`,
  "χ": String.raw`\chi`,
  "ψ": String.raw`\psi`,
  "ω": String.raw`\omega`,
  "Γ": String.raw`\Gamma`,
  "Δ": String.raw`\Delta`,
  "Θ": String.raw`\Theta`,
  "Λ": String.raw`\Lambda`,
  "Ξ": String.raw`\Xi`,
  "Π": String.raw`\Pi`,
  "Σ": String.raw`\Sigma`,
  "Φ": String.raw`\Phi`,
  "Ψ": String.raw`\Psi`,
  "Ω": String.raw`\Omega`,
  "∑": String.raw`\sum`,
  "∏": String.raw`\prod`,
  "∫": String.raw`\int`,
  "∮": String.raw`\oint`,
  "∂": String.raw`\partial`,
  "∇": String.raw`\nabla`,
  "∞": String.raw`\infty`,
  "≤": String.raw`\le`,
  "≥": String.raw`\ge`,
  "≠": String.raw`\ne`,
  "≈": String.raw`\approx`,
  "≡": String.raw`\equiv`,
  "±": String.raw`\pm`,
  "∓": String.raw`\mp`,
  "×": String.raw`\times`,
  "÷": String.raw`\div`,
  "·": String.raw`\cdot`,
  "→": String.raw`\to`,
  "←": String.raw`\leftarrow`,
  "⇒": String.raw`\Rightarrow`,
  "⇐": String.raw`\Leftarrow`,
  "↦": String.raw`\mapsto`,
  "∈": String.raw`\in`,
  "∉": String.raw`\notin`,
  "⊂": String.raw`\subset`,
  "⊆": String.raw`\subseteq`,
  "∪": String.raw`\cup`,
  "∩": String.raw`\cap`,
  "∀": String.raw`\forall`,
  "∃": String.raw`\exists`,
  "¬": String.raw`\neg`,
  "∧": String.raw`\wedge`,
  "∨": String.raw`\vee`,
  "√": String.raw`\surd`,
  "∝": String.raw`\propto`,
  "∅": String.raw`\emptyset`,
  "ℝ": String.raw`\mathbb{R}`,
  "ℕ": String.raw`\mathbb{N}`,
  "ℤ": String.raw`\mathbb{Z}`,
  "¹": "^{1}",
  "²": "^{2}",
  "³": "^{3}",
  "°": String.raw`^{\circ}`,
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
  const symbols = [...t.matchAll(SYM_RE_G)].length + [...t.matchAll(/[=+^]/g)].length;
  return symbols >= 3 && symbols / t.replace(/\s/g, "").length > 0.12;
}

export function stripMathDelimiters(text: string): string {
  return text.replaceAll("$", "");
}
