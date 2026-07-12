import { useEffect, useState } from "react";
import { AlertCircle, BookOpen, Loader2, Quote, Search } from "lucide-react";
import { useCitationStore } from "@/store/citation";
import { resolveCitation, bibtexForHit, addCitation } from "@/features/citation";
import type { CitationHit } from "@/lib/citation/types";
import { toast } from "@/lib/toast";

type Status = "idle" | "loading" | "hits" | "preview" | "error";

const EXAMPLES = [
  { label: "DOI", value: "10.1038/nature14539" },
  { label: "arXiv", value: "1706.03762" },
  { label: "Title", value: "Attention is all you need" },
];

/**
 * Add a citation by pasting a DOI/arXiv id/URL (fetched directly) or typing a
 * title to search Crossref. Appends BibTeX to the project's .bib (deduped by
 * DOI) and inserts \cite at the cursor.
 */
export function AddCitationDialog() {
  const open = useCitationStore((s) => s.open);
  const setOpen = useCitationStore((s) => s.setOpen);

  const [input, setInput] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [hits, setHits] = useState<CitationHit[]>([]);
  const [bibtex, setBibtex] = useState("");
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (open) {
      setInput("");
      setStatus("idle");
      setHits([]);
      setBibtex("");
      setError("");
      setAdding(false);
    }
  }, [open]);

  if (!open) return null;

  const close = () => setOpen(false);

  const search = async (raw?: string) => {
    const q = (raw ?? input).trim();
    if (!q) return;
    setError("");
    setStatus("loading");
    const r = await resolveCitation(q);
    if (r.error) {
      setError(r.error);
      setStatus("error");
    } else if (r.bibtex) {
      setBibtex(r.bibtex);
      setStatus("preview");
    } else {
      setHits(r.hits ?? []);
      if ((r.hits ?? []).length === 0) {
        setError("No results found. Check the identifier, or try different title words.");
        setStatus("error");
      } else {
        setStatus("hits");
      }
    }
  };

  const pick = async (hit: CitationHit) => {
    setStatus("loading");
    setBibtex(await bibtexForHit(hit));
    setStatus("preview");
  };

  const add = async () => {
    setAdding(true);
    const r = await addCitation(bibtex);
    setAdding(false);
    if ("key" in r) {
      close();
      toast.success(`Added \\cite{${r.key}}`);
    } else {
      setError(r.error);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/40 pt-[15vh]" onClick={close}>
      <div
        className="flex max-h-[60vh] w-[34rem] max-w-[92vw] flex-col rounded-lg border bg-popover text-popover-foreground shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-3 py-2.5">
          <Quote className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Add citation</span>
        </div>

        <div className="border-b p-3">
          <div className="flex items-center gap-2 rounded-md border border-input bg-background py-1 pl-2.5 pr-1">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void search();
                if (e.key === "Escape") close();
              }}
              placeholder="DOI, arXiv id, URL, or a paper title…"
              className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <button
              onClick={() => void search()}
              disabled={status === "loading" || !input.trim()}
              className="inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded bg-primary px-2.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {status === "loading" && <Loader2 className="size-3.5 animate-spin" />}
              Look up
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Only the identifier or title is sent, to doi.org, arXiv, or Crossref.
          </p>
        </div>

        <div className="flex-1 overflow-auto p-3">
          {status === "idle" && (
            <div className="py-1">
              <p className="text-xs text-muted-foreground">
                Paste a DOI, an arXiv id, or a URL to fetch the entry directly, or type a title to
                search Crossref. Try one:
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex.label}
                    onClick={() => {
                      setInput(ex.value);
                      void search(ex.value);
                    }}
                    className="rounded-full border border-sidebar-border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <span className="font-medium text-foreground/80">{ex.label}:</span> {ex.value}
                  </button>
                ))}
              </div>
            </div>
          )}

          {status === "loading" && (
            <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Looking up "{input.trim()}"…
            </div>
          )}

          {status === "error" && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {status === "hits" && (
            <div className="flex flex-col gap-1">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {hits.length} {hits.length === 1 ? "match" : "matches"} from Crossref. Pick one:
              </p>
              {hits.map((h, i) => (
                <button
                  key={`${h.doi ?? h.title}:${i}`}
                  onClick={() => void pick(h)}
                  className="rounded-md border border-sidebar-border px-2.5 py-2 text-left hover:bg-accent"
                >
                  <div className="flex items-start gap-2">
                    <BookOpen className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="text-sm leading-snug">{h.title}</div>
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {[h.authors.slice(0, 3).join("; "), h.year, h.venue].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {status === "preview" && (
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Entry</p>
              <pre className="max-h-52 overflow-auto rounded-md border border-sidebar-border bg-background p-2.5 font-mono text-[11px] leading-relaxed">
                {bibtex}
              </pre>
              {error && (
                <div className="mt-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {status === "preview" && (
          <div className="flex justify-end gap-2 border-t p-3">
            <button onClick={close} className="rounded-md border border-input px-3 py-1.5 text-xs hover:bg-accent">
              Cancel
            </button>
            <button
              onClick={() => void add()}
              disabled={adding}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {adding && <Loader2 className="size-3.5 animate-spin" />}
              {adding ? "Adding…" : "Add to .bib and cite"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
