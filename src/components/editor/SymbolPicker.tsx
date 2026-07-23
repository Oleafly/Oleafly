import { useState } from "react";
import { Pi } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { insertAtCursor } from "@/components/editor/cm/controller";

interface Symbol {
  char: string;
  name: string;
  latex: string;
}

const CATEGORIES: { label: string; items: Symbol[] }[] = [
  {
    label: "Lowercase Greek",
    items: [
      { char: "α", name: "Alpha", latex: "\\alpha" },
      { char: "β", name: "Beta", latex: "\\beta" },
      { char: "γ", name: "Gamma", latex: "\\gamma" },
      { char: "δ", name: "Delta", latex: "\\delta" },
      { char: "ε", name: "Epsilon", latex: "\\epsilon" },
      { char: "ε", name: "Varepsilon", latex: "\\varepsilon" },
    ],
  },
];

export function SymbolPicker({ menuRow }: { menuRow?: boolean }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  return (
    <Popover
      ariaLabel="Insert symbol"
      className="w-64 p-2"
      triggerClassName={menuRow ? "w-full justify-start gap-2 px-2 font-normal" : undefined}
      trigger={
        menuRow ? (
          <>
            <Pi className="size-4" />
            <span className="flex-1 text-left">Symbols</span>
          </>
        ) : (
          <Pi className="size-4" />
        )
      }
    >
      <Input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search symbols..."
        aria-label="Search symbols"
        className="mb-2 h-8 text-sm"
      />
      <div className="max-h-72 overflow-y-auto">
        {CATEGORIES.map((category) => {
          const items = q ? category.items.filter((s) => s.name.toLowerCase().includes(q)) : category.items;
          if (!items.length) return null;
          return (
            <div key={category.label} className="py-1">
              <span className="block px-1 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                {category.label}
              </span>
              {items.map((s) => (
                <button
                  type="button"
                  key={s.name}
                  onClick={() => insertAtCursor(s.latex)}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
                >
                  <span className="text-base">{s.char}</span>
                  <span className="text-xs text-muted-foreground">{s.name}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </Popover>
  );
}
