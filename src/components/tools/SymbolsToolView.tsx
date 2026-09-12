import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpenText, Copy, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import {
  ToolPane,
  ToolPreviewSurface,
  ToolSegmentedControl,
  ToolSplitView,
  ToolStatus,
} from "@/components/tools/ToolWorkspace";
import { getEditorView, insertAtCursor } from "@/components/editor/cm/controller";
import { isWysiwygActive } from "@/components/editor/wysiwyg/controller";
import { useHomeViewStore } from "@/store/home-view";
import { useFilesStore } from "@/store/files";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

interface SymbolEntry {
  command: string;
  glyph: string;
  note: string;
  category: Category;
}

type Category = "Greek" | "Arrows" | "Relations" | "Operators" | "Miscellaneous";
type SymbolFilter = "All" | Category;

const CATEGORY_ORDER: Category[] = [
  "Greek",
  "Arrows",
  "Relations",
  "Operators",
  "Miscellaneous",
];
const MAX_VISIBLE_SYMBOLS = 180;

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
  const first = [...detail].find((ch) => /\p{L}|\p{S}|\p{N}/u.test(ch) && !/[a-zA-Z()"]/.test(ch));
  return first ?? "";
}

interface SymbolLoad {
  entries: SymbolEntry[];
  failed: boolean;
}

async function loadSymbols(): Promise<SymbolLoad> {
  const entries: SymbolEntry[] = [];
  const commands = new Set<string>();
  let failed = false;
  try {
    const unimath = (await fetch("/latex-intelligence/unimath.json").then((r) =>
      r.ok ? r.json() : {},
    )) as Record<string, { detail?: string; documentation?: string }>;
    for (const [name, value] of Object.entries(unimath)) {
      const glyph = value.detail ? glyphFromDetail(value.detail) : "";
      if (!glyph) continue;
      const command = `\\${name}`;
      if (commands.has(command)) continue;
      commands.add(command);
      entries.push({
        command,
        glyph,
        note: value.documentation ?? "",
        category: categoryFor(name),
      });
    }
  } catch {
    failed = true;
  }
  try {
    const core = (await fetch("/latex-intelligence/core.json").then((r) =>
      r.ok ? r.json() : { commands: [] },
    )) as { commands: { name: string; detail?: string; documentation?: string }[] };
    for (const command of core.commands) {
      const glyph = command.detail ? glyphFromDetail(command.detail) : "";
      const name = `\\${command.name}`;
      if (!glyph || commands.has(name)) continue;
      commands.add(name);
      entries.push({
        command: name,
        glyph,
        note: command.documentation ?? command.detail ?? "",
        category: categoryFor(command.name),
      });
    }
  } catch {
    failed = true;
  }
  return { entries, failed: failed && entries.length === 0 };
}

function canInsertInOpenLatexEditor(): boolean {
  const files = useFilesStore.getState();
  const latexSource = files.activePath?.toLowerCase().endsWith(".tex")
    && files.engine.capabilities.formatting_profile === "latex";
  return Boolean(files.projectId && latexSource && (getEditorView() || isWysiwygActive()));
}

export function SymbolsToolView() {
  const activePage = useHomeViewStore((state) => state.page);
  const goTo = useHomeViewStore((state) => state.goTo);
  const projectId = useFilesStore((state) => state.projectId);
  const activePath = useFilesStore((state) => state.activePath);
  const formattingProfile = useFilesStore((state) => state.engine.capabilities.formatting_profile);
  const [entries, setEntries] = useState<SymbolEntry[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<SymbolFilter>("All");
  const [selectedCommand, setSelectedCommand] = useState<string | null>(null);
  const request = useRef(0);

  useEffect(() => {
    if (activePage !== "symbols" || entries !== null) return;
    const id = ++request.current;
    void loadSymbols().then((loaded) => {
      if (id !== request.current) return;
      setEntries(loaded.entries);
      setLoadFailed(loaded.failed);
    });
  }, [activePage, entries]);

  const filtered = useMemo(() => {
    if (!entries) return null;
    const normalizedQuery = query.trim().toLowerCase();
    return entries.filter((entry) =>
      (category === "All" || entry.category === category)
      && (!normalizedQuery
        || entry.command.toLowerCase().includes(normalizedQuery)
        || entry.glyph === normalizedQuery
        || entry.note.toLowerCase().includes(normalizedQuery)),
    );
  }, [category, entries, query]);
  const visible = useMemo(() => filtered?.slice(0, MAX_VISIBLE_SYMBOLS) ?? [], [filtered]);
  const selected = visible.find((entry) => entry.command === selectedCommand) ?? visible[0] ?? null;
  const insertionAvailable = Boolean(
    projectId
    && activePath?.toLowerCase().endsWith(".tex")
    && formattingProfile === "latex"
    && (getEditorView() || isWysiwygActive()),
  );

  useEffect(() => {
    if (visible.length > 0 && !visible.some((entry) => entry.command === selectedCommand)) {
      setSelectedCommand(visible[0].command);
    }
  }, [selectedCommand, visible]);

  if (activePage !== "symbols") return null;

  const retry = () => {
    request.current += 1;
    setLoadFailed(false);
    setEntries(null);
  };

  const copyCommand = async () => {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.command);
      toast.success("Command copied.");
    } catch {
      toast.error("Oleafly could not copy the command. Try again.");
    }
  };

  const insertCommand = () => {
    if (!selected) return;
    if (!canInsertInOpenLatexEditor()) return;
    insertAtCursor(selected.command.endsWith("{}") ? selected.command : `${selected.command} `);
    toast.success(`Inserted ${selected.command} in the open editor.`);
    goTo("library");
  };

  const moveSelection = (
    index: number,
    direction: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown",
    columns: number,
  ) => {
    const offset = direction === "ArrowLeft" ? -1 : direction === "ArrowRight" ? 1 : direction === "ArrowUp" ? -columns : columns;
    const next = Math.min(Math.max(index + offset, 0), visible.length - 1);
    const entry = visible[next];
    if (!entry) return;
    setSelectedCommand(entry.command);
    document.getElementById(`symbol-entry-${next}`)?.focus();
  };

  const status = entries === null
    ? <ToolStatus state="busy">Loading symbols</ToolStatus>
    : loadFailed
      ? <ToolStatus state="error">Reference unavailable</ToolStatus>
      : <ToolStatus state="ready">{entries.length} symbols</ToolStatus>;

  return (
    <ToolPageShell
      page="symbols"
      title="Symbols"
      subtitle="Browse LaTeX commands and symbols"
      icon={BookOpenText}
      showTheme
      status={status}
      testId="symbols-tool-view"
    >
      <ToolSplitView storageId="symbol-reference">
        <ToolPane
          title="Library"
          badge={filtered ? `${filtered.length}` : undefined}
          footer={(
            <div className="space-y-2">
              <ToolSegmentedControl
                label="Symbol category"
                value={category}
                options={[
                  { value: "All", label: "All", testId: "symbols-category-all" },
                  ...CATEGORY_ORDER.map((value) => ({ value, label: value, testId: `symbols-category-${value.toLowerCase()}` })),
                ]}
                onChange={setCategory}
              />
              {filtered && filtered.length > MAX_VISIBLE_SYMBOLS ? (
                <p className="text-xs text-muted-foreground">Showing the first {MAX_VISIBLE_SYMBOLS}. Search to narrow the list.</p>
              ) : null}
            </div>
          )}
        >
          <div className="border-b px-4 py-3">
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search a command, glyph, or description"
                aria-label="Search symbols"
                data-testid="symbols-search"
                className="pl-8"
              />
            </div>
          </div>
          {entries === null ? (
            <div className="p-4 text-sm text-muted-foreground">Loading the symbol reference…</div>
          ) : loadFailed ? (
            <div className="space-y-3 p-4 text-sm text-muted-foreground">
              <p>The symbol reference could not load.</p>
              <Button variant="outline" size="sm" onClick={retry}>Try again</Button>
            </div>
          ) : visible.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No symbols match this search.</div>
          ) : (
            <div
              role="listbox"
              aria-label="Symbol results"
              data-testid="symbols-grid"
              className="grid grid-cols-3 gap-2 p-4 sm:grid-cols-4"
            >
              {visible.map((entry, index) => (
                <button
                  id={`symbol-entry-${index}`}
                  key={`${entry.category}-${entry.command}`}
                  type="button"
                  role="option"
                  aria-selected={selected?.command === entry.command}
                  tabIndex={selected?.command === entry.command ? 0 : -1}
                  data-testid={`symbol-entry-${entry.command.slice(1)}`}
                  title={entry.note || entry.command}
                  onClick={() => setSelectedCommand(entry.command)}
                  onFocus={() => setSelectedCommand(entry.command)}
                  onKeyDown={(event) => {
                    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
                      event.preventDefault();
                      const grid = event.currentTarget.parentElement;
                      const gridColumns = grid
                        ? getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length || 3
                        : 3;
                      moveSelection(
                        index,
                        event.key as "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown",
                        gridColumns,
                      );
                    }
                  }}
                  className={cn(
                    "flex min-w-0 flex-col items-center gap-1 rounded-md border px-2 py-2 text-center transition-colors",
                    selected?.command === entry.command
                      ? "border-primary/40 bg-accent"
                      : "bg-card hover:border-primary/40 hover:bg-accent",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  )}
                >
                  <span className="font-serif text-xl leading-none">{entry.glyph}</span>
                  <span className="w-full truncate font-mono text-[11px] text-muted-foreground">{entry.command}</span>
                </button>
              ))}
            </div>
          )}
        </ToolPane>

        <ToolPane
          title="Preview"
          badge={selected?.category}
          actions={selected ? (
            <Button variant="outline" size="sm" onClick={() => void copyCommand()}>
              <Copy className="size-4" /> Copy command
            </Button>
          ) : undefined}
          footer={selected ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {insertionAvailable
                  ? "Insert into the open LaTeX document."
                  : "Copy the command into your LaTeX document."}
              </p>
              <Button size="sm" onClick={insertCommand} disabled={!insertionAvailable}>Insert in editor</Button>
            </div>
          ) : undefined}
        >
          <ToolPreviewSurface className="items-center justify-center text-center">
            {selected ? (
              <div className="flex max-w-lg flex-col items-center gap-4">
                <span className="font-serif text-7xl leading-none" aria-hidden="true">{selected.glyph}</span>
                <code data-testid="symbols-command" className="rounded-md border bg-background px-3 py-2 font-mono text-sm">{selected.command}</code>
                <p className="text-sm text-muted-foreground">{selected.note || "No description is available for this command."}</p>
              </div>
            ) : entries === null ? (
              <p className="text-sm text-muted-foreground">Loading a symbol to preview.</p>
            ) : (
              <p className="text-sm text-muted-foreground">Choose a symbol from the library.</p>
            )}
          </ToolPreviewSurface>
        </ToolPane>
      </ToolSplitView>
    </ToolPageShell>
  );
}
