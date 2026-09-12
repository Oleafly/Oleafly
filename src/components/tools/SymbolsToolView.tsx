import { useEffect, useMemo, useState } from "react";
import { BookOpenText, Search } from "lucide-react";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import { useHomeViewStore } from "@/store/home-view";
import { insertAtCursor } from "@/components/editor/cm/controller";
import { toast } from "@/lib/toast";

interface SymbolEntry {
  command: string;
  glyph: string;
  note: string;
  category: Category;
}

type Category = "Greek" | "Arrows" | "Relations" | "Operators" | "Miscellaneous";

const CATEGORY_ORDER: Category[] = [
  "Greek",
  "Arrows",
  "Relations",
  "Operators",
  "Miscellaneous",
];

const GREEK = new Set([
  "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta",
  "theta", "vartheta", "iota", "kappa", "varkappa", "lambda", "mu", "nu", "xi",
  "omicron", "pi", "varpi", "rho", "varrho", "sigma", "varsigma", "tau",
  "upsilon", "phi", "varphi", "chi", "psi", "omega", "digamma",
  "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon", "Phi",
  "Psi", "Omega",
]);

function categoryFor(name: string): Category {
  if (GREEK.has(name)) return "Greek";
  if (/arrow|hookrightarrow|maps(to|from)|leadsto|nearrow|searrow|swarrow|nwarrow|^to$|^gets$|implies|impliedby|rightleftharpoons/.test(name)) {
    return "Arrows";
  }
  if (/^(n)?(leq|geq|less|gtr|equiv|sim|simeq|approx|cong|propto|prec|succ|subset|supset|in|ni|perp|parallel|mid|asymp|doteq|ll|gg|ne)$/.test(name)
    || /lesssim|gtrsim|lessgtr|gtrless|subseteq|supseteq|sqsubset|preceq|succeq/.test(name)) {
    return "Relations";
  }
  if (/sum|prod|coprod|int|oint|iint|iiint|bigcup|bigcap|bigvee|bigwedge|biguplus|bigotimes|bigoplus|bigodot|cdot|times|ast|star|circ|bullet|oplus|ominus|otimes|oslash|odot|dagger|ddagger|amalg|setminus|wr|diamond|bigtriangleup|bigtriangledown|lhd|rhd|uplus/.test(name)) {
    return "Operators";
  }
  return "Miscellaneous";
}

/** First glyph character from a corpus detail like "𝔸 (\"mathbb\" command)". */
function glyphFromDetail(detail: string): string {
  const first = [...detail].find((ch) => /\p{L}|\p{S}|\p{N}/u.test(ch) && !/[a-zA-Z()"]/u.test(ch));
  return first ?? "";
}

async function loadSymbols(): Promise<SymbolEntry[]> {
  const entries: SymbolEntry[] = [];
  try {
    const unimath = (await fetch("/latex-intelligence/unimath.json").then((r) =>
      r.ok ? r.json() : {},
    )) as Record<string, { detail?: string; documentation?: string }>;
    for (const [name, value] of Object.entries(unimath)) {
      const glyph = value.detail ? glyphFromDetail(value.detail) : "";
      if (!glyph) continue;
      entries.push({
        command: `\\${name}`,
        glyph,
        note: value.documentation ?? "",
        category: categoryFor(name),
      });
    }
  } catch {
    // The corpus is bundled with the app; a failure here is unexpected.
  }
  try {
    const core = (await fetch("/latex-intelligence/core.json").then((r) =>
      r.ok ? r.json() : { commands: [] },
    )) as { commands: { name: string; detail?: string; documentation?: string }[] };
    for (const command of core.commands) {
      const glyph = command.detail ? glyphFromDetail(command.detail) : "";
      if (!glyph || entries.some((e) => e.command === `\\${command.name}`)) {
        continue;
      }
      entries.push({
        command: `\\${command.name}`,
        glyph,
        note: command.documentation ?? command.detail ?? "",
        category: categoryFor(command.name),
      });
    }
  } catch {
    // ignore; unimath alone is already a full cheatsheet
  }
  return entries;
}

export function SymbolsToolView() {
  const activePage = useHomeViewStore((s) => s.page);
  const [entries, setEntries] = useState<SymbolEntry[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (activePage === "symbols" && entries === null) {
      void loadSymbols().then(setEntries);
    }
  }, [activePage, entries]);

  const filtered = useMemo(() => {
    if (!entries) return null;
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (entry) =>
        entry.command.toLowerCase().includes(q) ||
        entry.glyph === q ||
        entry.note.toLowerCase().includes(q),
    );
  }, [entries, query]);

  if (activePage !== "symbols") return null;

  const insert = (entry: SymbolEntry) => {
    insertAtCursor(entry.command.endsWith("{}") ? entry.command : `${entry.command} `);
    toast.success(`${entry.command} inserted at the cursor.`);
  };

  return (
    <ToolPageShell
      page="symbols"
      title="Symbol Reference"
      subtitle="Browse and insert LaTeX symbols from the completion corpus"
      icon={BookOpenText}
      testId="symbols-tool-view"
    >
      <div className="flex items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search aria-hidden className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search a command, glyph, or description…"
            aria-label="Search symbols"
            data-testid="symbols-search"
            className="h-9 w-full rounded-md border bg-transparent pl-8 pr-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <span className="text-xs text-muted-foreground" data-testid="symbols-count">
          {filtered ? `${filtered.length} symbols` : "loading…"}
        </span>
      </div>

      {filtered === null ? (
        <p className="text-sm text-muted-foreground">Loading the symbol corpus…</p>
      ) : (
        <div className="space-y-6" data-testid="symbols-sections">
          {CATEGORY_ORDER.map((category) => {
            const rows = filtered.filter((entry) => entry.category === category);
            if (rows.length === 0) return null;
            return (
              <section key={category} className="space-y-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {category} · {rows.length}
                </h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {rows.slice(0, 400).map((entry) => (
                    <button
                      key={`${entry.category}-${entry.command}`}
                      type="button"
                      title={entry.note || entry.command}
                      onClick={() => insert(entry)}
                      className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <span className="w-6 shrink-0 text-center font-serif text-xl leading-none">
                        {entry.glyph}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                        {entry.command}
                      </span>
                    </button>
                  ))}
                </div>
                {rows.length > 400 ? (
                  <p className="text-[10px] text-muted-foreground">
                    {rows.length - 400} more in this category; search to narrow.
                  </p>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </ToolPageShell>
  );
}
