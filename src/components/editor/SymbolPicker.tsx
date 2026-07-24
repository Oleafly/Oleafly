import { useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Omega } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { insertAtCursor } from "@/components/editor/cm/controller";

interface Symbol {
  char: string;
  latex: string;
  name: string;
}

interface Category {
  id: string;
  label: string;
  items: Symbol[];
}

const CATEGORIES: Category[] = [
  {
    id: "greek",
    label: "Greek",
    items: [
      { char: "α", latex: "\\alpha", name: "alpha" },
      { char: "β", latex: "\\beta", name: "beta" },
      { char: "γ", latex: "\\gamma", name: "gamma" },
      { char: "δ", latex: "\\delta", name: "delta" },
      { char: "ε", latex: "\\epsilon", name: "epsilon" },
      { char: "ϵ", latex: "\\varepsilon", name: "varepsilon" },
      { char: "ζ", latex: "\\zeta", name: "zeta" },
      { char: "η", latex: "\\eta", name: "eta" },
      { char: "ϑ", latex: "\\vartheta", name: "vartheta" },
      { char: "θ", latex: "\\theta", name: "theta" },
      { char: "ι", latex: "\\iota", name: "iota" },
      { char: "κ", latex: "\\kappa", name: "kappa" },
      { char: "λ", latex: "\\lambda", name: "lambda" },
      { char: "μ", latex: "\\mu", name: "mu" },
      { char: "ν", latex: "\\nu", name: "nu" },
      { char: "ξ", latex: "\\xi", name: "xi" },
      { char: "π", latex: "\\pi", name: "pi" },
      { char: "ϖ", latex: "\\varpi", name: "varpi" },
      { char: "ρ", latex: "\\rho", name: "rho" },
      { char: "σ", latex: "\\sigma", name: "sigma" },
      { char: "ς", latex: "\\varsigma", name: "varsigma" },
      { char: "τ", latex: "\\tau", name: "tau" },
      { char: "υ", latex: "\\upsilon", name: "upsilon" },
      { char: "ϕ", latex: "\\phi", name: "phi" },
      { char: "φ", latex: "\\varphi", name: "varphi" },
      { char: "χ", latex: "\\chi", name: "chi" },
      { char: "ψ", latex: "\\psi", name: "psi" },
      { char: "ω", latex: "\\omega", name: "omega" },
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
    id: "arrows",
    label: "Arrows",
    items: [
      { char: "←", latex: "\\leftarrow", name: "leftarrow" },
      { char: "→", latex: "\\rightarrow", name: "rightarrow" },
      { char: "↔", latex: "\\leftrightarrow", name: "leftrightarrow" },
      { char: "↑", latex: "\\uparrow", name: "uparrow" },
      { char: "↓", latex: "\\downarrow", name: "downarrow" },
      { char: "⇐", latex: "\\Leftarrow", name: "Leftarrow" },
      { char: "⇒", latex: "\\Rightarrow", name: "Rightarrow" },
      { char: "⇔", latex: "\\Leftrightarrow", name: "Leftrightarrow" },
      { char: "↦", latex: "\\mapsto", name: "mapsto" },
      { char: "↗", latex: "\\nearrow", name: "nearrow" },
      { char: "↘", latex: "\\searrow", name: "searrow" },
      { char: "⇌", latex: "\\rightleftharpoons", name: "rightleftharpoons" },
      { char: "↼", latex: "\\leftharpoonup", name: "leftharpoonup" },
      { char: "⇀", latex: "\\rightharpoonup", name: "rightharpoonup" },
    ],
  },
  {
    id: "operators",
    label: "Operators",
    items: [
      { char: "×", latex: "\\times", name: "times" },
      { char: "÷", latex: "\\div", name: "div" },
      { char: "∩", latex: "\\cap", name: "cap" },
      { char: "∪", latex: "\\cup", name: "cup" },
      { char: "·", latex: "\\cdot", name: "cdot" },
      { char: "⋯", latex: "\\cdots", name: "cdots" },
      { char: "•", latex: "\\bullet", name: "bullet" },
      { char: "∘", latex: "\\circ", name: "circ" },
      { char: "∧", latex: "\\wedge", name: "wedge" },
      { char: "∨", latex: "\\vee", name: "vee" },
      { char: "\\", latex: "\\setminus", name: "setminus" },
      { char: "⊕", latex: "\\oplus", name: "oplus" },
      { char: "⊗", latex: "\\otimes", name: "otimes" },
      { char: "Σ", latex: "\\sum", name: "sum" },
      { char: "Π", latex: "\\prod", name: "prod" },
      { char: "⋂", latex: "\\bigcap", name: "bigcap" },
      { char: "⋃", latex: "\\bigcup", name: "bigcup" },
      { char: "∫", latex: "\\int", name: "int" },
      { char: "∬", latex: "\\iint", name: "iint" },
      { char: "∭", latex: "\\iiint", name: "iiint" },
    ],
  },
  {
    id: "relations",
    label: "Relations",
    items: [
      { char: "≠", latex: "\\neq", name: "neq" },
      { char: "≤", latex: "\\leq", name: "leq" },
      { char: "≥", latex: "\\geq", name: "geq" },
      { char: "≪", latex: "\\ll", name: "ll" },
      { char: "≫", latex: "\\gg", name: "gg" },
      { char: "<", latex: "\\lt", name: "lt" },
      { char: ">", latex: "\\gt", name: "gt" },
      { char: "∈", latex: "\\in", name: "in" },
      { char: "∉", latex: "\\notin", name: "notin" },
      { char: "∋", latex: "\\ni", name: "ni" },
      { char: "⊂", latex: "\\subset", name: "subset" },
      { char: "⊆", latex: "\\subseteq", name: "subseteq" },
      { char: "⊃", latex: "\\supset", name: "supset" },
      { char: "≃", latex: "\\simeq", name: "simeq" },
      { char: "≈", latex: "\\approx", name: "approx" },
      { char: "≡", latex: "\\equiv", name: "equiv" },
      { char: "≅", latex: "\\cong", name: "cong" },
      { char: "∣", latex: "\\mid", name: "mid" },
      { char: "⊢", latex: "\\vdash", name: "vdash" },
      { char: "∥", latex: "\\parallel", name: "parallel" },
      { char: "⊥", latex: "\\perp", name: "perp" },
    ],
  },
  {
    id: "misc",
    label: "Misc",
    items: [
      { char: "∞", latex: "\\infty", name: "infty" },
      { char: "∂", latex: "\\partial", name: "partial" },
      { char: "∇", latex: "\\nabla", name: "nabla" },
      { char: "∅", latex: "\\emptyset", name: "emptyset" },
      { char: "∀", latex: "\\forall", name: "forall" },
      { char: "∃", latex: "\\exists", name: "exists" },
      { char: "¬", latex: "\\neg", name: "neg" },
      { char: "ℜ", latex: "\\Re", name: "Re" },
      { char: "ℑ", latex: "\\Im", name: "Im" },
      { char: "□", latex: "\\square", name: "square" },
      { char: "△", latex: "\\triangle", name: "triangle" },
      { char: "ℵ", latex: "\\aleph", name: "aleph" },
      { char: "℘", latex: "\\wp", name: "wp" },
      { char: "#", latex: "\\#", name: "hash" },
      { char: "$", latex: "\\$", name: "dollar" },
      { char: "%", latex: "\\%", name: "percent" },
      { char: "&", latex: "\\&", name: "ampersand" },
      { char: "{", latex: "\\{", name: "lbrace" },
      { char: "}", latex: "\\}", name: "rbrace" },
      { char: "⟨", latex: "\\langle", name: "langle" },
      { char: "⟩", latex: "\\rangle", name: "rangle" },
    ],
  },
];

function SymbolButton({ symbol }: { symbol: Symbol }) {
  return (
    <PopoverPrimitive.Close asChild>
      <button
        type="button"
        onClick={() => insertAtCursor(symbol.latex)}
        title={symbol.name}
        className="flex size-9 items-center justify-center rounded-md bg-muted text-base text-foreground transition-colors hover:bg-accent"
      >
        {symbol.char}
      </button>
    </PopoverPrimitive.Close>
  );
}

export function SymbolPicker({ menuRow }: { menuRow?: boolean }) {
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState(CATEGORIES[0].id);
  const q = query.trim().toLowerCase();

  const visibleItems = q
    ? CATEGORIES.flatMap((c) => c.items).filter((s) => s.name.toLowerCase().includes(q))
    : (CATEGORIES.find((c) => c.id === activeTab) ?? CATEGORIES[0]).items;

  return (
    <Popover
      ariaLabel="Insert symbol"
      className="w-[26rem] p-0"
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
      <div className="flex h-80">
        <div className="flex w-28 shrink-0 flex-col gap-0.5 border-r p-2">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setActiveTab(c.id)}
              className={cn(
                "rounded px-2 py-1 text-left text-xs font-medium transition-colors",
                !q && activeTab === c.id
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {c.label}
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
              className="h-7 text-xs"
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
