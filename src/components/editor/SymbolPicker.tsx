import { useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Omega } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { insertAtCursor } from "@/components/editor/cm/controller";

export interface ToolbarSymbol {
  char: string;
  latex: string;
  name: string;
}

export interface SymbolCategory {
  id: string;
  label: string;
  items: ToolbarSymbol[];
}

export const SYMBOL_CATEGORIES: SymbolCategory[] = [
  {
    id: "greek-lower",
    label: "Greek (lower)",
    items: [
      { char: "α", latex: "\\alpha", name: "alpha" },
      { char: "β", latex: "\\beta", name: "beta" },
      { char: "γ", latex: "\\gamma", name: "gamma" },
      { char: "δ", latex: "\\delta", name: "delta" },
      { char: "ϵ", latex: "\\epsilon", name: "epsilon" },
      { char: "ε", latex: "\\varepsilon", name: "varepsilon" },
      { char: "ζ", latex: "\\zeta", name: "zeta" },
      { char: "η", latex: "\\eta", name: "eta" },
      { char: "θ", latex: "\\theta", name: "theta" },
      { char: "ϑ", latex: "\\vartheta", name: "vartheta" },
      { char: "ι", latex: "\\iota", name: "iota" },
      { char: "κ", latex: "\\kappa", name: "kappa" },
      { char: "λ", latex: "\\lambda", name: "lambda" },
      { char: "μ", latex: "\\mu", name: "mu" },
      { char: "ν", latex: "\\nu", name: "nu" },
      { char: "ξ", latex: "\\xi", name: "xi" },
      { char: "π", latex: "\\pi", name: "pi" },
      { char: "ϖ", latex: "\\varpi", name: "varpi" },
      { char: "ρ", latex: "\\rho", name: "rho" },
      { char: "ϱ", latex: "\\varrho", name: "varrho" },
      { char: "σ", latex: "\\sigma", name: "sigma" },
      { char: "ς", latex: "\\varsigma", name: "varsigma" },
      { char: "τ", latex: "\\tau", name: "tau" },
      { char: "υ", latex: "\\upsilon", name: "upsilon" },
      { char: "ϕ", latex: "\\phi", name: "phi" },
      { char: "φ", latex: "\\varphi", name: "varphi" },
      { char: "χ", latex: "\\chi", name: "chi" },
      { char: "ψ", latex: "\\psi", name: "psi" },
      { char: "ω", latex: "\\omega", name: "omega" },
    ],
  },
  {
    id: "greek-upper",
    label: "Greek (upper)",
    items: [
      { char: "Γ", latex: "\\Gamma", name: "Gamma" },
      { char: "Δ", latex: "\\Delta", name: "Delta" },
      { char: "Θ", latex: "\\Theta", name: "Theta" },
      { char: "Λ", latex: "\\Lambda", name: "Lambda" },
      { char: "Ξ", latex: "\\Xi", name: "Xi" },
      { char: "Π", latex: "\\Pi", name: "Pi" },
      { char: "Σ", latex: "\\Sigma", name: "Sigma" },
      { char: "Υ", latex: "\\Upsilon", name: "Upsilon" },
      { char: "Φ", latex: "\\Phi", name: "Phi" },
      { char: "Ψ", latex: "\\Psi", name: "Psi" },
      { char: "Ω", latex: "\\Omega", name: "Omega" },
    ],
  },
  {
    id: "operators",
    label: "Operators",
    items: [
      { char: "+", latex: "+", name: "plus" },
      { char: "−", latex: "-", name: "minus" },
      { char: "×", latex: "\\times", name: "times" },
      { char: "÷", latex: "\\div", name: "division" },
      { char: "⋅", latex: "\\cdot", name: "centered dot" },
      { char: "±", latex: "\\pm", name: "plus-minus" },
      { char: "∓", latex: "\\mp", name: "minus-plus" },
      { char: "∗", latex: "\\ast", name: "asterisk" },
      { char: "⋆", latex: "\\star", name: "star" },
      { char: "∘", latex: "\\circ", name: "circle" },
      { char: "•", latex: "\\bullet", name: "bullet" },
      { char: "⊕", latex: "\\oplus", name: "circled plus" },
      { char: "⊖", latex: "\\ominus", name: "circled minus" },
      { char: "⊗", latex: "\\otimes", name: "circled times" },
      { char: "⊙", latex: "\\odot", name: "circled dot" },
      { char: "†", latex: "\\dagger", name: "dagger" },
      { char: "‡", latex: "\\ddagger", name: "double dagger" },
      { char: "∇", latex: "\\nabla", name: "nabla / del" },
      { char: "∂", latex: "\\partial", name: "partial derivative" },
    ],
  },
  {
    id: "relations",
    label: "Relations",
    items: [
      { char: "=", latex: "=", name: "equals" },
      { char: "≠", latex: "\\neq", name: "not equal" },
      { char: "<", latex: "<", name: "less than" },
      { char: ">", latex: ">", name: "greater than" },
      { char: "≤", latex: "\\leq", name: "less or equal" },
      { char: "≥", latex: "\\geq", name: "greater or equal" },
      { char: "≪", latex: "\\ll", name: "much less" },
      { char: "≫", latex: "\\gg", name: "much greater" },
      { char: "≈", latex: "\\approx", name: "approximately" },
      { char: "∼", latex: "\\sim", name: "similar / tilde" },
      { char: "≃", latex: "\\simeq", name: "asymptotically equal" },
      { char: "≅", latex: "\\cong", name: "congruent" },
      { char: "≡", latex: "\\equiv", name: "identical / equivalent" },
      { char: "∝", latex: "\\propto", name: "proportional to" },
      { char: "≺", latex: "\\prec", name: "precedes" },
      { char: "≻", latex: "\\succ", name: "succeeds" },
      { char: "⪯", latex: "\\preceq", name: "precedes or equal" },
      { char: "⪰", latex: "\\succeq", name: "succeeds or equal" },
      { char: "⊥", latex: "\\perp", name: "perpendicular" },
      { char: "∥", latex: "\\parallel", name: "parallel" },
      { char: "∣", latex: "\\mid", name: "divides / mid" },
    ],
  },
  {
    id: "arrows",
    label: "Arrows",
    items: [
      { char: "←", latex: "\\leftarrow", name: "left arrow" },
      { char: "→", latex: "\\rightarrow", name: "right arrow" },
      { char: "↑", latex: "\\uparrow", name: "up arrow" },
      { char: "↓", latex: "\\downarrow", name: "down arrow" },
      { char: "↔", latex: "\\leftrightarrow", name: "left-right arrow" },
      { char: "⇐", latex: "\\Leftarrow", name: "double left arrow" },
      { char: "⇒", latex: "\\Rightarrow", name: "double right arrow (implies)" },
      { char: "⇑", latex: "\\Uparrow", name: "double up arrow" },
      { char: "⇓", latex: "\\Downarrow", name: "double down arrow" },
      { char: "⇔", latex: "\\Leftrightarrow", name: "double left-right (iff)" },
      { char: "↦", latex: "\\mapsto", name: "maps to" },
      { char: "⟼", latex: "\\longmapsto", name: "long maps to" },
      { char: "⟶", latex: "\\longrightarrow", name: "long right arrow" },
      { char: "⟵", latex: "\\longleftarrow", name: "long left arrow" },
      { char: "↪", latex: "\\hookrightarrow", name: "hook right arrow" },
      { char: "↩", latex: "\\hookleftarrow", name: "hook left arrow" },
      { char: "↗", latex: "\\nearrow", name: "NE arrow" },
      { char: "↘", latex: "\\searrow", name: "SE arrow" },
      { char: "↖", latex: "\\nwarrow", name: "NW arrow" },
      { char: "↙", latex: "\\swarrow", name: "SW arrow" },
      { char: "⇌", latex: "\\rightleftharpoons", name: "equilibrium harpoons" },
      { char: "↼", latex: "\\leftharpoonup", name: "left harpoon" },
      { char: "⇀", latex: "\\rightharpoonup", name: "right harpoon" },
    ],
  },
  {
    id: "sets",
    label: "Set Theory",
    items: [
      { char: "∈", latex: "\\in", name: "element of" },
      { char: "∉", latex: "\\notin", name: "not element of" },
      { char: "∋", latex: "\\ni", name: "contains as member" },
      { char: "⊂", latex: "\\subset", name: "subset" },
      { char: "⊃", latex: "\\supset", name: "superset" },
      { char: "⊆", latex: "\\subseteq", name: "subset or equal" },
      { char: "⊇", latex: "\\supseteq", name: "superset or equal" },
      { char: "∪", latex: "\\cup", name: "union" },
      { char: "∩", latex: "\\cap", name: "intersection" },
      { char: "⋃", latex: "\\bigcup", name: "big union" },
      { char: "⋂", latex: "\\bigcap", name: "big intersection" },
      { char: "∖", latex: "\\setminus", name: "set minus" },
      { char: "∅", latex: "\\emptyset", name: "empty set" },
      { char: "∅", latex: "\\varnothing", name: "empty set (variant)" },
      { char: "ℕ", latex: "\\mathbb{N}", name: "natural numbers" },
      { char: "ℤ", latex: "\\mathbb{Z}", name: "integers" },
      { char: "ℚ", latex: "\\mathbb{Q}", name: "rationals" },
      { char: "ℝ", latex: "\\mathbb{R}", name: "real numbers" },
      { char: "ℂ", latex: "\\mathbb{C}", name: "complex numbers" },
    ],
  },
  {
    id: "logic",
    label: "Logic",
    items: [
      { char: "∀", latex: "\\forall", name: "for all" },
      { char: "∃", latex: "\\exists", name: "exists" },
      { char: "∄", latex: "\\nexists", name: "does not exist" },
      { char: "¬", latex: "\\neg", name: "negation" },
      { char: "∧", latex: "\\land", name: "logical and" },
      { char: "∨", latex: "\\lor", name: "logical or" },
      { char: "∧", latex: "\\wedge", name: "wedge" },
      { char: "∨", latex: "\\vee", name: "vee" },
      { char: "⟹", latex: "\\implies", name: "implies" },
      { char: "⟺", latex: "\\iff", name: "if and only if" },
      { char: "∴", latex: "\\therefore", name: "therefore" },
      { char: "∵", latex: "\\because", name: "because" },
      { char: "⊤", latex: "\\top", name: "top / true" },
      { char: "⊥", latex: "\\bot", name: "bottom / false" },
      { char: "⊢", latex: "\\vdash", name: "proves / turnstile" },
      { char: "⊨", latex: "\\models", name: "models / entails" },
    ],
  },
  {
    id: "calculus",
    label: "Calculus",
    items: [
      { char: "∫", latex: "\\int", name: "integral" },
      { char: "∬", latex: "\\iint", name: "double integral" },
      { char: "∭", latex: "\\iiint", name: "triple integral" },
      { char: "∮", latex: "\\oint", name: "contour integral" },
      { char: "∑", latex: "\\sum", name: "summation" },
      { char: "∏", latex: "\\prod", name: "product" },
      { char: "∐", latex: "\\coprod", name: "coproduct" },
      { char: "lim", latex: "\\lim", name: "limit" },
      { char: "∞", latex: "\\infty", name: "infinity" },
      { char: "∇", latex: "\\nabla", name: "nabla / gradient" },
      { char: "∂", latex: "\\partial", name: "partial" },
      { char: "√x", latex: "\\sqrt{}", name: "square root" },
      { char: "a/b", latex: "\\frac{}{}", name: "fraction" },
      { char: "C(n,k)", latex: "\\binom{}{}", name: "binomial" },
      { char: "sup", latex: "\\sup", name: "supremum" },
      { char: "inf", latex: "\\inf", name: "infimum" },
      { char: "max", latex: "\\max", name: "maximum" },
      { char: "min", latex: "\\min", name: "minimum" },
    ],
  },
  {
    id: "functions",
    label: "Functions",
    items: [
      { char: "sin", latex: "\\sin", name: "sine" },
      { char: "cos", latex: "\\cos", name: "cosine" },
      { char: "tan", latex: "\\tan", name: "tangent" },
      { char: "cot", latex: "\\cot", name: "cotangent" },
      { char: "sec", latex: "\\sec", name: "secant" },
      { char: "csc", latex: "\\csc", name: "cosecant" },
      { char: "arcsin", latex: "\\arcsin", name: "arcsine" },
      { char: "arccos", latex: "\\arccos", name: "arccosine" },
      { char: "arctan", latex: "\\arctan", name: "arctangent" },
      { char: "sinh", latex: "\\sinh", name: "hyperbolic sine" },
      { char: "cosh", latex: "\\cosh", name: "hyperbolic cosine" },
      { char: "tanh", latex: "\\tanh", name: "hyperbolic tangent" },
      { char: "log", latex: "\\log", name: "logarithm" },
      { char: "ln", latex: "\\ln", name: "natural log" },
      { char: "exp", latex: "\\exp", name: "exponential" },
      { char: "det", latex: "\\det", name: "determinant" },
      { char: "dim", latex: "\\dim", name: "dimension" },
      { char: "ker", latex: "\\ker", name: "kernel" },
      { char: "arg", latex: "\\arg", name: "argument" },
    ],
  },
  {
    id: "brackets",
    label: "Brackets",
    items: [
      { char: "(", latex: "(", name: "left paren" },
      { char: ")", latex: ")", name: "right paren" },
      { char: "[", latex: "[", name: "left bracket" },
      { char: "]", latex: "]", name: "right bracket" },
      { char: "{", latex: "\\{", name: "left brace" },
      { char: "}", latex: "\\}", name: "right brace" },
      { char: "⟨", latex: "\\langle", name: "left angle bracket" },
      { char: "⟩", latex: "\\rangle", name: "right angle bracket" },
      { char: "⌊", latex: "\\lfloor", name: "left floor" },
      { char: "⌋", latex: "\\rfloor", name: "right floor" },
      { char: "⌈", latex: "\\lceil", name: "left ceiling" },
      { char: "⌉", latex: "\\rceil", name: "right ceiling" },
      { char: "|", latex: "|", name: "vertical bar" },
      { char: "‖", latex: "\\|", name: "double vertical bar / norm" },
      { char: "( )", latex: "\\left( \\right)", name: "auto-sized parens" },
      { char: "[ ]", latex: "\\left[ \\right]", name: "auto-sized brackets" },
    ],
  },
  {
    id: "accents",
    label: "Accents",
    items: [
      { char: "â", latex: "\\hat{}", name: "hat" },
      { char: "ā", latex: "\\bar{}", name: "bar / overline accent" },
      { char: "ã", latex: "\\tilde{}", name: "tilde accent" },
      { char: "a⃗", latex: "\\vec{}", name: "vector arrow" },
      { char: "ȧ", latex: "\\dot{}", name: "dot (derivative)" },
      { char: "ä", latex: "\\ddot{}", name: "double dot" },
      { char: "á", latex: "\\acute{}", name: "acute accent" },
      { char: "à", latex: "\\grave{}", name: "grave accent" },
      { char: "ă", latex: "\\breve{}", name: "breve" },
      { char: "ǎ", latex: "\\check{}", name: "check / caron" },
      { char: "a̅b̅c̅", latex: "\\overline{}", name: "overline" },
      { char: "a̲b̲c̲", latex: "\\underline{}", name: "underline" },
      { char: "abc⏞", latex: "\\overbrace{}", name: "overbrace" },
      { char: "abc⏟", latex: "\\underbrace{}", name: "underbrace" },
    ],
  },
  {
    id: "spacing",
    label: "Dots & Spacing",
    items: [
      { char: "⋯", latex: "\\cdots", name: "centered dots" },
      { char: "…", latex: "\\ldots", name: "lower dots" },
      { char: "⋮", latex: "\\vdots", name: "vertical dots" },
      { char: "⋱", latex: "\\ddots", name: "diagonal dots" },
      { char: "␣", latex: "\\quad", name: "quad space" },
      { char: "␣␣", latex: "\\qquad", name: "double quad space" },
      { char: "\\,", latex: "\\,", name: "thin space" },
      { char: "\\;", latex: "\\;", name: "medium space" },
      { char: "\\!", latex: "\\!", name: "negative thin space" },
      { char: "text", latex: "\\text{}", name: "text in math mode" },
      { char: "rm", latex: "\\mathrm{}", name: "roman (upright) math" },
      { char: "bf", latex: "\\mathbf{}", name: "bold math" },
      { char: "𝒜", latex: "\\mathcal{}", name: "calligraphic" },
    ],
  },
  {
    id: "misc",
    label: "Misc",
    items: [
      { char: "ℏ", latex: "\\hbar", name: "h-bar (Planck)" },
      { char: "ℓ", latex: "\\ell", name: "script l" },
      { char: "℘", latex: "\\wp", name: "Weierstrass p" },
      { char: "ℜ", latex: "\\Re", name: "real part" },
      { char: "ℑ", latex: "\\Im", name: "imaginary part" },
      { char: "ℵ", latex: "\\aleph", name: "aleph" },
      { char: "∠", latex: "\\angle", name: "angle" },
      { char: "△", latex: "\\triangle", name: "triangle" },
      { char: "⋄", latex: "\\diamond", name: "diamond" },
      { char: "□", latex: "\\square", name: "square" },
      { char: "◊", latex: "\\lozenge", name: "lozenge" },
      { char: "♣", latex: "\\clubsuit", name: "club" },
      { char: "♢", latex: "\\diamondsuit", name: "diamond suit" },
      { char: "♡", latex: "\\heartsuit", name: "heart" },
      { char: "♠", latex: "\\spadesuit", name: "spade" },
      { char: "°", latex: "^{\\circ}", name: "degree" },
      { char: "#", latex: "\\#", name: "hash" },
      { char: "$", latex: "\\$", name: "dollar" },
      { char: "%", latex: "\\%", name: "percent" },
      { char: "&", latex: "\\&", name: "ampersand" },
    ],
  },
];

export function insertToolbarSymbol(symbol: ToolbarSymbol): void {
  insertAtCursor(symbol.latex);
}

function SymbolButton({ symbol }: { symbol: ToolbarSymbol }) {
  return (
    <Tooltip
      label={
        <>
          {symbol.name} <span className="font-mono opacity-70">({symbol.latex})</span>
        </>
      }
      delay={150}
    >
      <PopoverPrimitive.Close asChild>
        <button
          type="button"
          onClick={() => insertToolbarSymbol(symbol)}
          aria-label={`Insert ${symbol.name} (${symbol.latex})`}
          className={cn(
            "flex h-9 min-w-9 items-center justify-center rounded-md bg-muted px-1.5 text-foreground transition-colors hover:bg-accent",
            symbol.char.length > 2 ? "text-xs" : "text-base",
          )}
        >
          {symbol.char}
        </button>
      </PopoverPrimitive.Close>
    </Tooltip>
  );
}

// A few macros (\nabla, \partial) live in more than one category, so the All
// tab and search results dedupe by latex to avoid showing the same chip twice.
const dedupeByLatex = (items: ToolbarSymbol[]) => [
  ...new Map(items.map((s) => [s.latex, s] as const)).values(),
];

const ALL_SYMBOLS = dedupeByLatex(SYMBOL_CATEGORIES.flatMap((c) => c.items));

export function SymbolPicker({ menuRow }: { menuRow?: boolean }) {
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const q = query.trim().toLowerCase();

  const visibleItems = q
    ? dedupeByLatex(
        SYMBOL_CATEGORIES.flatMap((c) => c.items).filter(
          (s) => s.name.toLowerCase().includes(q) || s.latex.toLowerCase().includes(q),
        ),
      )
    : activeTab === "all"
      ? ALL_SYMBOLS
      : (SYMBOL_CATEGORIES.find((c) => c.id === activeTab) ?? SYMBOL_CATEGORIES[0]).items;

  return (
    <Popover
      ariaLabel="Insert symbol"
      className="w-[34rem] p-0"
      closeOnClick={false}
      triggerClassName={menuRow ? "w-full justify-start gap-2 px-2 font-normal" : undefined}
      trigger={
        menuRow ? (
          <>
            <Omega className="size-4" />
            <span className="flex-1 text-left">Symbols</span>
          </>
        ) : (
          <Omega className="size-4" />
        )
      }
    >
      <div className="flex h-96">
        <div className="flex w-40 shrink-0 flex-col gap-0.5 overflow-y-auto border-r p-2">
          {[{ id: "all", label: "All", items: ALL_SYMBOLS }, ...SYMBOL_CATEGORIES].map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setActiveTab(c.id)}
              aria-pressed={activeTab === c.id}
              className={cn(
                "flex items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs font-medium transition-colors",
                !q && activeTab === c.id
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <span className="truncate">{c.label}</span>
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[10px] tabular-nums">
                {c.items.length}
              </span>
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-b p-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              aria-label="Search symbols"
              className="h-8 text-xs"
            />
          </div>
          <div className="flex flex-1 flex-wrap content-start gap-1 overflow-y-auto p-2">
            {visibleItems.length === 0 ? (
              <p className="w-full py-4 text-center text-xs text-muted-foreground">No symbols match.</p>
            ) : (
              visibleItems.map((s) => <SymbolButton key={s.latex} symbol={s} />)
            )}
          </div>
        </div>
      </div>
    </Popover>
  );
}
