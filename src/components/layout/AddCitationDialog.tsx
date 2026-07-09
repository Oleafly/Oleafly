import { useEffect, useState } from "react";
import { Loader2, Quote, Search } from "lucide-react";
import { useCitationStore } from "@/store/citation";
import { resolveCitation, bibtexForHit, addCitation } from "@/features/citation";
import type { CitationHit } from "@/lib/citation/types";
import { toast } from "@/lib/toast";

type Status = "idle" | "loading" | "hits" | "preview" | "error";

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

  useEffect(() => {
    if (open) {
      setInput("");
      setStatus("idle");
      setHits([]);
      setBibtex("");
      setError("");
    }
  }, [open]);

  if (!open) return null;

  const close = () => setOpen(false);

  const search = async () => {
    if (!input.trim()) return;
    setStatus("loading");
    const r = await resolveCitation(input.trim());
    if (r.error) {
      setError(r.error);
      setStatus("error");
    } else if (r.bibtex) {
      setBibtex(r.bibtex);
      setStatus("preview");
    } else {
      setHits(r.hits ?? []);
      if ((r.hits ?? []).length === 0) {
        setError("No results found.");
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
    const r = await addCitation(bibtex);
    close();
    if ("key" in r) toast.success(`Added \\cite{${r.key}}`);
    else toast.error(r.error);
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
          <div className="flex items-center gap-2 rounded-md border border-input bg-background px-2.5">
            <Search className="size-4 text-muted-foreground" />
            <input
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void search();
                if (e.key === "Escape") close();
              }}
              placeholder="DOI, arXiv id, URL, or a paper title…"
              className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <button
              onClick={() => void search()}
              disabled={status === "loading" || !input.trim()}
              className="rounded bg-primary px-2 py-1 text-xs text-white hover:opacity-90 disabled:opacity-50"
            >
              {status === "loading" ? <Loader2 className="size-3.5 animate-spin" /> : "Look up"}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Only the identifier or title is sent, to doi.org, arXiv, or Crossref.
          </p>
        </div>

        <div className="flex-1 overflow-auto p-3">
          {status === "error" && <p className="text-sm text-red-500">{error}</p>}

          {status === "hits" && (
            <div className="flex flex-col gap-1">
              {hits.map((h, i) => (
                <button
                  key={`${h.doi ?? h.title}:${i}`}
                  onClick={() => void pick(h)}
                  className="rounded-md border border-sidebar-border px-2.5 py-2 text-left hover:bg-accent"
                >
                  <div className="text-sm leading-snug">{h.title}</div>
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {[h.authors.slice(0, 3).join("; "), h.year, h.venue].filter(Boolean).join(" · ")}
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
            </div>
          )}
        </div>

        {status === "preview" && (
          <div className="flex justify-end gap-2 border-t p-3">
            <button onClick={close} className="rounded-md border border-input px-3 py-1.5 text-xs hover:bg-accent">
              Cancel
            </button>
            <button onClick={() => void add()} className="rounded-md bg-primary px-3 py-1.5 text-xs text-white hover:opacity-90">
              Add to .bib and cite
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
