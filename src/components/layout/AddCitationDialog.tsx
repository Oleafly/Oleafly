import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, AtSign, BookOpen, Search } from "lucide-react";
import { useCitationStore } from "@/store/citation";
import { resolveCitation, bibtexForHit, addCitation } from "@/features/citation";
import { citationBibliographyChoices } from "@/features/citation-bibliographies";
import {
  preferredBibliography,
  rememberBibliography,
  rememberedBibliography,
} from "@/lib/citation/bibliography-choices";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CitationHit } from "@/lib/citation/types";
import { logError } from "@/lib/log";
import { toast } from "@/lib/toast";
import { objectKey } from "@/lib/react-key";
import { ModalShell } from "@/components/ui/modal-shell";
import { Input } from "@/components/ui/input";
import { i18n } from "@/i18n";
import { useFilesStore } from "@/store/files";
import { Spinner } from "@/components/ui/spinner";
import { LoadingState } from "@/components/ui/empty";
import { ZoteroHintBanner } from "@/components/zotero/ZoteroHintBanner";
import { useZoteroSearch } from "@/components/zotero/use-zotero-search";
import { insertZoteroCitation } from "@/features/zotero-actions";
import { hitByline, hitTitle, libraryLabel, truncated } from "@/lib/zotero/format";
import { zoteroSearchable } from "@/lib/zotero/hint";
import { useZoteroLibraryStore } from "@/store/zotero-library";
import type { ZoteroHit } from "@oleafly/backend-port";

type Status = "idle" | "loading" | "hits" | "preview" | "error";

const EXAMPLES = [
  {
    id: "doi",
    get label() {
      return i18n.t(($) => $.shell.addCitation.examples.doi);
    },
    value: "10.1038/nature14539",
  },
  {
    id: "arxiv",
    get label() {
      return i18n.t(($) => $.shell.addCitation.examples.arxiv);
    },
    value: "1706.03762",
  },
  {
    id: "title",
    get label() {
      return i18n.t(($) => $.shell.addCitation.examples.title);
    },
    value: "Attention is all you need",
  },
];

export function AddCitationDialog() {
  const { t } = useTranslation(["common", "shell"]);
  const open = useCitationStore((s) => s.open);
  const setOpen = useCitationStore((s) => s.setOpen);

  const [input, setInput] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [hits, setHits] = useState<CitationHit[]>([]);
  const [bibtex, setBibtex] = useState("");
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [bibliographies, setBibliographies] = useState<string[]>([]);
  const [bibliography, setBibliography] = useState<string | null>(null);
  const close = () => setOpen(false);
  const zoteroStatus = useZoteroLibraryStore((state) => state.status);
  const zoteroReady = zoteroSearchable(zoteroStatus);
  const { hits: zoteroHits } = useZoteroSearch(open && status !== "preview" ? input : "", 6);

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

  useEffect(() => {
    if (!open) return;
    let current = true;
    setBibliographies([]);
    setBibliography(null);
    const projectId = useFilesStore.getState().projectId;
    void citationBibliographyChoices()
      .then((choices) => {
        if (!current) return;
        setBibliographies(choices);
        setBibliography(preferredBibliography(choices, projectId ? rememberedBibliography(projectId) : null));
      })
      .catch((error_) => void logError("list citation bibliographies", error_));
    return () => {
      current = false;
    };
  }, [open]);

  if (!open) return null;

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
        setError(t(($) => $.shell.addCitation.noResults));
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

  const pickZotero = (hit: ZoteroHit) => {
    const cite = insertZoteroCitation(hit);
    close();
    if (cite) toast.success(i18n.t(($) => $.shell.addCitation.added, { cite }));
  };

  const add = async () => {
    setAdding(true);
    const chosen = bibliographies.length > 1 ? bibliography : null;
    try {
      const r = chosen ? await addCitation(bibtex, { bibliography: chosen }) : await addCitation(bibtex);
      if ("key" in r) {
        const projectId = useFilesStore.getState().projectId;
        if (chosen && projectId) rememberBibliography(projectId, chosen);
        close();
        toast.success(i18n.t(($) => $.shell.addCitation.added, { cite: r.cite ?? r.key }));
      } else {
        setError(r.error);
      }
    } catch (error_) {
      void logError("add citation", error_);
      setError(i18n.t(($) => $.researchTools.citationScan.addFailed));
    } finally {
      setAdding(false);
    }
  };

  return (
    <ModalShell
      open
      onClose={close}
      closeLabel={t(($) => $.shell.addCitation.close)}
      align="top"
      labelledBy="citation-dialog-title"
      className="flex max-h-[60vh] w-[34rem] max-w-[92vw] flex-col"
    >
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <AtSign className="size-4 text-muted-foreground" />
        <span id="citation-dialog-title" className="text-sm font-semibold">
          {t(($) => $.shell.addCitation.title)}
        </span>
      </div>

      <div className="border-b p-3">
        <div className="flex items-center gap-2 rounded-md bg-muted/30 py-1 pl-2.5 pr-1 dark:bg-background">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <Input
            data-modal-initial-focus
            value={input}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void search();
              if (e.key === "Escape") close();
            }}
            placeholder={
              zoteroReady
                ? t(($) => $.shell.addCitation.zoteroPlaceholder)
                : t(($) => $.shell.addCitation.placeholder)
            }
            className="h-9 w-full border-0 bg-transparent text-sm shadow-none placeholder:text-muted-foreground"
          />
          <button type="button"
            onClick={() => void search()}
            disabled={status === "loading" || !input.trim()}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded bg-primary px-2.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {status === "loading" && <Spinner size="sm" />}
            {t(($) => $.shell.addCitation.lookUp)}
          </button>
        </div>
        <p className="mt-1.5 text-[0.6875rem] text-muted-foreground">
          {t(($) => $.shell.addCitation.privacyNote)}
        </p>
      </div>

      <ZoteroHintBanner onOpenSettings={close} />

      {zoteroHits.length > 0 && status !== "preview" && (
        <section className="border-b p-3" aria-labelledby="citation-dialog-zotero" data-testid="add-citation-zotero">
          <p id="citation-dialog-zotero" className="mb-1 text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground">
            {t(($) => $.shell.addCitation.zoteroMatches)}
          </p>
          <div className="flex flex-col gap-0.5">
            {zoteroHits.map((hit) => (
              <button
                type="button"
                key={`${hit.library}:${hit.itemKey}`}
                onClick={() => pickZotero(hit)}
                className="rounded-md border border-transparent px-2.5 py-1.5 text-left hover:bg-accent focus-visible:bg-accent"
              >
                <span className="flex items-baseline gap-2">
                  <span className="shrink-0 font-mono text-xs">{hit.citationKey}</span>
                  <span className="min-w-0 truncate text-[0.6875rem] text-muted-foreground">
                    {[hitByline(hit), truncated(hitTitle(hit)), libraryLabel(hit, zoteroStatus)].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="flex-1 overflow-auto p-3">
        {status === "idle" && (
          <div className="py-1">
            <p className="text-xs text-muted-foreground">
              {t(($) => $.shell.addCitation.hint)}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button type="button"
                  key={ex.id}
                  onClick={() => {
                    setInput(ex.value);
                    void search(ex.value);
                  }}
                  className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[0.6875rem] text-primary hover:bg-primary/20"
                >
                  <span className="font-medium">{`${ex.label}:`}</span> {ex.value}
                </button>
              ))}
            </div>
          </div>
        )}

        {status === "loading" && (
          <LoadingState
            className="py-2"
            label={t(($) => $.shell.addCitation.lookingUp, { query: input.trim() })}
          />
        )}

        {status === "error" && (
          <div className="flex select-text items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {status === "hits" && (
          <div className="flex flex-col gap-1">
            <p className="mb-1 text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground">
              {t(($) => $.shell.addCitation.matches, { count: hits.length })}
            </p>
            {hits.map((h) => (
              <button type="button"
                key={objectKey(h, "citation")}
                onClick={() => void pick(h)}
                className="rounded-md border border-sidebar-border px-2.5 py-2 text-left hover:bg-accent"
              >
                <div className="flex items-start gap-2">
                  <BookOpen className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="text-sm leading-snug">{h.title}</div>
                    <div className="mt-0.5 truncate text-[0.6875rem] text-muted-foreground">
                      {[h.authors.slice(0, 3).join(", "), h.year, h.venue].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {status === "preview" && (
          <div>
            <p className="mb-1 text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground">
              {t(($) => $.shell.addCitation.entry)}
            </p>
            <pre data-select-all-scope className="max-h-52 select-text overflow-auto rounded-md border border-sidebar-border bg-background p-2.5 font-mono text-[0.6875rem] leading-relaxed">
              {bibtex}
            </pre>
            {bibliographies.length > 1 && bibliography && (
              <div className="mt-3">
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-xs font-medium">
                    {t(($) => $.shell.addCitation.bibliography)}
                  </span>
                  <Select value={bibliography} onValueChange={setBibliography}>
                    <SelectTrigger
                      aria-label={t(($) => $.shell.addCitation.bibliography)}
                      className="h-8 min-w-0 flex-1 text-xs"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[100]">
                      {bibliographies.map((path) => (
                        <SelectItem key={path} value={path} className="text-xs">
                          {path}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="mt-1 text-[0.6875rem] text-muted-foreground">
                  {t(($) => $.shell.addCitation.bibliographyHint)}
                </p>
              </div>
            )}
            {error && (
              <div className="mt-2 flex select-text items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {status === "preview" && (
        <div className="flex justify-end gap-2 border-t p-3">
          <button type="button" onClick={close} className="rounded-md border border-input px-3 py-1.5 text-xs hover:bg-accent">
            {t(($) => $.common.actions.cancel)}
          </button>
          <button type="button"
            onClick={() => void add()}
            disabled={adding}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {adding && <Spinner size="sm" />}
            {adding
              ? t(($) => $.shell.addCitation.adding)
              : t(($) => $.shell.addCitation.confirm)}
          </button>
        </div>
      )}
    </ModalShell>
  );
}
