import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  Copy,
  Download,
  Loader2,
  Plus,
  RotateCcw,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CodeField } from "@/components/tools/CodeField";
import { ToolPageShell } from "@/components/tools/ToolPageShell";
import {
  ToolPane,
  ToolSegmentedControl,
  ToolSplitView,
  ToolStatus,
} from "@/components/tools/ToolWorkspace";
import { bibtexLanguage } from "@/components/editor/cm/bibtex";
import { bibtexForHit, resolveCitation } from "@/features/citation";
import { pickSavePath } from "@/lib/native-file-dialog";
import {
  CITATION_STYLES,
  EMPTY_REFERENCE,
  EXAMPLE_REFERENCE,
  bibtexToForm,
  detectCitationTarget,
  formToBibtex,
  formatCitations,
  inspectBibtex,
  webpageBibtex,
  type CitationStyleId,
  type ReferenceFormData,
  type ReferenceToolId,
} from "@/lib/reference-tools";
import type { CitationHit } from "@/lib/citation/types";
import { writeBytesFile } from "@/lib/tauri";
import { toolById } from "@/lib/tool-catalog";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useHomeViewStore } from "@/store/home-view";
import { useSettingsStore } from "@/store/settings";

type OutputMode = "reference" | "in-text" | "bibtex";
type BibliographyInputMode = "fields" | "bibtex";

const BIBLIOGRAPHY_EXAMPLE = `${formToBibtex(EXAMPLE_REFERENCE)}

@book{knuth1984texbook,
  author = {Donald E. Knuth},
  title = {The TeXbook},
  publisher = {Addison-Wesley},
  year = {1984},
  isbn = {9780201134483}
}`;

const TOOL_CONTENT: Record<ReferenceToolId, {
  title: string;
  subtitle: string;
  queryLabel: string;
  queryPlaceholder: string;
  queryExample: string;
}> = {
  "arxiv-citation-generator": {
    title: "arXiv Citation Generator",
    subtitle: "Editable citations in eight styles",
    queryLabel: "arXiv ID or URL",
    queryPlaceholder: "1706.03762 or an arxiv.org link",
    queryExample: "1706.03762",
  },
  "bibliography-generator": {
    title: "Bibliography Generator",
    subtitle: "Build, validate, sort, and export references",
    queryLabel: "Reference",
    queryPlaceholder: "",
    queryExample: "",
  },
  "citation-generator": {
    title: "Citation Generator",
    subtitle: "Structured details, identifiers, and BibTeX",
    queryLabel: "DOI, arXiv ID, ISBN, PMID, title, or BibTeX",
    queryPlaceholder: "Paste an identifier, title, or BibTeX entry",
    queryExample: "Attention Is All You Need",
  },
  "citation-styles": {
    title: "Citation Generators by Style",
    subtitle: "Compare eight publication-ready styles",
    queryLabel: "Reference",
    queryPlaceholder: "",
    queryExample: "",
  },
  "doi-to-bibtex": {
    title: "DOI to BibTeX",
    subtitle: "Retrieve, review, and export a DOI record",
    queryLabel: "DOI",
    queryPlaceholder: "10.xxxx/… or a doi.org link",
    queryExample: "10.48550/arXiv.1706.03762",
  },
  "isbn-to-bibtex": {
    title: "ISBN to BibTeX",
    subtitle: "Retrieve and correct book metadata",
    queryLabel: "ISBN-10 or ISBN-13",
    queryPlaceholder: "978-0-262-03561-3",
    queryExample: "9780262035613",
  },
  "pubmed-to-bibtex": {
    title: "PubMed to BibTeX",
    subtitle: "Retrieve and review a PubMed record",
    queryLabel: "PMID or PubMed URL",
    queryPlaceholder: "31452104",
    queryExample: "31452104",
  },
  "url-to-bibtex": {
    title: "URL to BibTeX",
    subtitle: "Recognize scholarly links or build a webpage reference",
    queryLabel: "Web address",
    queryPlaceholder: "https://…",
    queryExample: "https://arxiv.org/abs/1706.03762",
  },
};

const EXPECTED_KIND: Partial<Record<ReferenceToolId, "doi" | "arxiv" | "isbn" | "pmid">> = {
  "arxiv-citation-generator": "arxiv",
  "doi-to-bibtex": "doi",
  "isbn-to-bibtex": "isbn",
  "pubmed-to-bibtex": "pmid",
};

const KIND_LABEL = {
  doi: "DOI",
  arxiv: "arXiv ID or URL",
  isbn: "ISBN-10 or ISBN-13",
  pmid: "PMID or PubMed URL",
} as const;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

async function saveBibtex(bibtex: string): Promise<void> {
  try {
    const destination = await pickSavePath({
      defaultPath: "references.bib",
      filters: [{ name: "BibTeX bibliography", extensions: ["bib"] }],
    });
    if (!destination) return;
    await writeBytesFile(destination, bytesToBase64(new TextEncoder().encode(bibtex)));
    toast.success("Saved references.bib");
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Oleafly couldn't save this bibliography.");
  }
}

async function copyText(text: string, label: string): Promise<void> {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`Copied ${label}`);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : `Oleafly couldn't copy ${label}.`);
  }
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const id = `reference-${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`;
  return (
    <label htmlFor={id} className={cn("grid gap-1.5 text-xs font-medium text-muted-foreground", className)}>
      {label}
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 bg-background text-sm font-normal text-foreground"
      />
    </label>
  );
}

function ReferenceFields({
  form,
  onChange,
}: {
  form: ReferenceFormData;
  onChange: (form: ReferenceFormData) => void;
}) {
  const update = <Key extends keyof ReferenceFormData>(key: Key, value: ReferenceFormData[Key]) =>
    onChange({ ...form, [key]: value });
  const containerLabel = form.type === "article"
    ? "Journal"
    : form.type === "inproceedings"
      ? "Conference or proceedings"
      : form.type === "incollection"
        ? "Book title"
        : "Container title";
  return (
    <div className="grid gap-3 p-4 sm:grid-cols-2">
      <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
        Reference type
        <select
          value={form.type}
          onChange={(event) => update("type", event.target.value as ReferenceFormData["type"])}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm font-normal text-foreground shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="article">Journal article</option>
          <option value="book">Book</option>
          <option value="incollection">Book chapter</option>
          <option value="inproceedings">Conference paper</option>
          <option value="misc">Webpage or other</option>
        </select>
      </label>
      <Field label="Year" value={form.year} placeholder="2026" onChange={(value) => update("year", value)} />
      <Field label="Title" value={form.title} onChange={(value) => update("title", value)} className="sm:col-span-2" />
      <label className="grid gap-1.5 text-xs font-medium text-muted-foreground sm:col-span-2">
        Authors
        <textarea
          value={form.authors}
          onChange={(event) => update("authors", event.target.value)}
          placeholder="Separate authors with semicolons"
          rows={2}
          className="min-h-16 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm font-normal text-foreground shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>
      {form.type !== "book" && (
        <Field label={containerLabel} value={form.container} onChange={(value) => update("container", value)} className="sm:col-span-2" />
      )}
      {(form.type === "book" || form.type === "incollection" || form.type === "inproceedings") && (
        <Field label="Publisher" value={form.publisher} onChange={(value) => update("publisher", value)} />
      )}
      <Field label="Volume" value={form.volume} onChange={(value) => update("volume", value)} />
      <Field label="Issue" value={form.issue} onChange={(value) => update("issue", value)} />
      <Field label="Pages" value={form.pages} placeholder="101--115" onChange={(value) => update("pages", value)} />
      <Field label="DOI" value={form.doi} onChange={(value) => update("doi", value)} />
      <Field label="ISBN" value={form.isbn} onChange={(value) => update("isbn", value)} />
      <Field label="PMID" value={form.pmid} onChange={(value) => update("pmid", value)} />
      <Field label="URL" value={form.url} onChange={(value) => update("url", value)} className="sm:col-span-2" />
    </div>
  );
}

function ValidationSummary({ bibtex }: { bibtex: string }) {
  const inspection = useMemo(() => inspectBibtex(bibtex), [bibtex]);
  const errors = [
    ...inspection.errors,
    ...inspection.findings.flatMap((finding) =>
      finding.level === "error" ? finding.messages.map((message) => `${finding.key}: ${message}`) : [],
    ),
  ];
  const warnings = inspection.findings.flatMap((finding) =>
    finding.level === "warning" ? finding.messages.map((message) => `${finding.key}: ${message}`) : [],
  );
  if (!bibtex.trim()) return null;
  return (
    <div className="border-t px-4 py-3 text-xs">
      <div className="flex items-center gap-2 font-medium">
        {errors.length ? <AlertCircle className="size-3.5 text-destructive" /> : <Check className="size-3.5 text-emerald-500" />}
        {errors.length
          ? `${errors.length} issue${errors.length === 1 ? "" : "s"} to fix`
          : `${inspection.entries} valid entr${inspection.entries === 1 ? "y" : "ies"}`}
      </div>
      {[...errors, ...warnings].slice(0, 4).map((message) => (
        <p key={message} className={cn("mt-1", errors.includes(message) ? "text-destructive" : "text-amber-700 dark:text-amber-300")}>
          {message}
        </p>
      ))}
    </div>
  );
}

function SearchResults({ hits, onSelect }: { hits: CitationHit[]; onSelect: (hit: CitationHit) => void }) {
  if (!hits.length) return null;
  return (
    <div className="border-b p-3" data-testid="reference-search-results">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Select the matching work
      </p>
      <div className="grid max-h-52 gap-2 overflow-y-auto">
        {hits.map((hit) => (
          <button
            key={`${hit.doi ?? hit.title}-${hit.year ?? ""}`}
            type="button"
            onClick={() => onSelect(hit)}
            className="rounded-lg border bg-card px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
          >
            <span className="block text-sm font-medium leading-snug">{hit.title}</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {[hit.authors.slice(0, 2).join(", "), hit.year, hit.venue].filter(Boolean).join(" · ")}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ReferenceOutput({
  bibtex,
  style,
  setStyle,
  mode,
  setMode,
  formattingError,
}: {
  bibtex: string;
  style: CitationStyleId;
  setStyle: (style: CitationStyleId) => void;
  mode: OutputMode;
  setMode: (mode: OutputMode) => void;
  formattingError: string | null;
}) {
  const editorTheme = useSettingsStore((state) => state.editorTheme);
  const deferredBibtex = useDeferredValue(bibtex);
  const rendered = useMemo(() => {
    if (formattingError) {
      return {
        formatted: { bibliography: "", inText: "", entries: 0 },
        error: formattingError,
      };
    }
    try {
      return { formatted: formatCitations(deferredBibtex, style), error: null };
    } catch (caught) {
      return {
        formatted: { bibliography: "", inText: "", entries: 0 },
        error: caught instanceof Error ? caught.message : "Oleafly couldn't format this BibTeX.",
      };
    }
  }, [deferredBibtex, formattingError, style]);
  const { formatted } = rendered;
  const output = mode === "reference" ? formatted.bibliography : mode === "in-text" ? formatted.inText : bibtex;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <ToolSegmentedControl
          label="Citation output"
          value={mode}
          onChange={setMode}
          options={[
            { value: "reference", label: "Reference" },
            { value: "in-text", label: "In-text" },
            { value: "bibtex", label: "BibTeX" },
          ]}
        />
        <select
          aria-label="Citation style"
          value={style}
          onChange={(event) => setStyle(event.target.value as CitationStyleId)}
          className="ml-auto h-8 rounded-md border border-input bg-background px-2 text-xs font-medium"
        >
          {CITATION_STYLES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {rendered.error ? (
          <div className="m-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" role="alert">
            <p className="font-medium">This reference needs attention</p>
            <p className="mt-1 text-xs leading-relaxed">{rendered.error}</p>
          </div>
        ) : mode === "bibtex" ? (
          <CodeField
            value={bibtex}
            onChange={() => undefined}
            readOnly
            language={bibtexLanguage}
            themeId={editorTheme}
            testId="reference-bibtex-output"
            className="min-h-64 flex-1 overflow-auto text-xs [&_.cm-editor]:h-full"
          />
        ) : (
          <div className="m-4 min-h-48 rounded-xl border bg-card p-6 shadow-sm">
            <p className="whitespace-pre-wrap font-serif text-[15px] leading-7" data-testid="formatted-citation-output">
              {output || "Add enough reference details to see the formatted result."}
            </p>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3">
        <span className="text-xs text-muted-foreground">{formatted.entries} {formatted.entries === 1 ? "reference" : "references"}</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={!output} onClick={() => void copyText(output, mode === "bibtex" ? "BibTeX" : "citation")}>
            <Copy className="size-3.5" /> Copy
          </Button>
          <Button size="sm" disabled={!bibtex.trim()} onClick={() => void saveBibtex(bibtex)}>
            <Download className="size-3.5" /> Save .bib
          </Button>
        </div>
      </div>
      <ValidationSummary bibtex={bibtex} />
    </>
  );
}

type StyleResult = (typeof CITATION_STYLES)[number] & ReturnType<typeof formatCitations> & {
  error?: string;
};

function StyleComparison({ bibtex, formattingError }: { bibtex: string; formattingError: string | null }) {
  const deferredBibtex = useDeferredValue(bibtex);
  const [rendered, setRendered] = useState<{
    styles: StyleResult[];
    error: string | null;
    pending: boolean;
  }>({ styles: [], error: null, pending: false });
  useEffect(() => {
    if (formattingError || !deferredBibtex.trim()) {
      setRendered({ styles: [], error: formattingError, pending: false });
      return;
    }
    let timer = 0;
    let index = 0;
    setRendered({ styles: [], error: null, pending: true });
    const renderNext = () => {
      const definition = CITATION_STYLES[index] as (typeof CITATION_STYLES)[number];
      let result: StyleResult;
      try {
        result = { ...definition, ...formatCitations(deferredBibtex, definition.id) };
      } catch (caught) {
        result = {
          ...definition,
          bibliography: "",
          inText: "",
          entries: 0,
          error: caught instanceof Error ? caught.message : "Oleafly couldn't format this style.",
        };
      }
      index += 1;
      setRendered((current) => ({
        ...current,
        styles: [...current.styles, result],
        pending: index < CITATION_STYLES.length,
      }));
      if (index < CITATION_STYLES.length) timer = window.setTimeout(renderNext, 0);
    };
    timer = window.setTimeout(renderNext, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [deferredBibtex, formattingError]);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      {rendered.error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" role="alert">
          {rendered.error}
        </div>
      ) : (
        <div className="grid gap-3">
          {rendered.pending && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
              <Loader2 className="size-3.5 animate-spin" /> Formatting styles locally…
            </p>
          )}
          {rendered.styles.map((style) => (
            <article key={style.id} className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">{style.label}</h3>
                  <p className="text-[11px] text-muted-foreground">{style.fullName}</p>
                </div>
                <Button variant="ghost" size="sm" disabled={!style.bibliography} onClick={() => void copyText(style.bibliography, `${style.label} citation`)}>
                  <Copy className="size-3.5" /> Copy
                </Button>
              </div>
              {style.error ? (
                <p className="mt-3 text-xs text-destructive" role="alert">{style.error}</p>
              ) : (
                <>
                  <p className="mt-3 whitespace-pre-wrap font-serif text-sm leading-6">{style.bibliography}</p>
                  <p className="mt-3 border-t pt-2 text-xs text-muted-foreground">In text: {style.inText}</p>
                </>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function ReferenceWorkspace({ id }: { id: ReferenceToolId }) {
  const content = TOOL_CONTENT[id];
  const catalog = toolById(id);
  const bibliographyMode = id === "bibliography-generator";
  const compareMode = id === "citation-styles";
  const initialForm = compareMode || id === "citation-generator"
    ? EXAMPLE_REFERENCE
    : EMPTY_REFERENCE;
  const [form, setForm] = useState<ReferenceFormData>(initialForm);
  const [bibtex, setBibtex] = useState(() =>
    bibliographyMode ? BIBLIOGRAPHY_EXAMPLE : compareMode || id === "citation-generator" ? formToBibtex(initialForm) : "",
  );
  const [query, setQuery] = useState(content.queryExample);
  const [style, setStyle] = useState<CitationStyleId>("apa");
  const [outputMode, setOutputMode] = useState<OutputMode>("reference");
  const [bibliographyInputMode, setBibliographyInputMode] = useState<BibliographyInputMode>("fields");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hits, setHits] = useState<CitationHit[]>([]);
  const requestId = useRef(0);
  const editorTheme = useSettingsStore((state) => state.editorTheme);

  useEffect(() => () => {
    requestId.current += 1;
  }, []);

  const inspection = useMemo(() => inspectBibtex(bibtex), [bibtex]);
  const formattingError = useMemo(() => {
    if (!bibtex.trim()) return null;
    if (inspection.errors.length) return inspection.errors[0] as string;
    return null;
  }, [bibtex, inspection.errors]);

  const applyBibtex = (next: string, successMessage: string) => {
    setBibtex(next.trim());
    const parsed = bibtexToForm(next);
    if (parsed) setForm(parsed);
    setHits([]);
    setError(null);
    setMessage(successMessage);
  };

  const updateForm = (next: ReferenceFormData) => {
    setForm(next);
    setBibtex(formToBibtex(next));
    setError(null);
    setMessage("Formatting locally as you type");
  };

  const runLookup = async () => {
    const input = query.trim();
    if (!input) {
      setError(`Enter ${content.queryLabel.toLowerCase()} first.`);
      return;
    }
    if (id === "citation-generator" && input.startsWith("@")) {
      applyBibtex(input, "BibTeX loaded locally");
      return;
    }
    const target = detectCitationTarget(input);
    const expected = EXPECTED_KIND[id];
    if (expected && target.kind !== expected) {
      setError(`Enter a valid ${KIND_LABEL[expected]}.`);
      return;
    }
    if (id === "url-to-bibtex") {
      if (target.kind === "title") {
        setError("Enter a complete http or https web address.");
        return;
      }
      if (target.kind === "url") {
        applyBibtex(
          webpageBibtex(target.value),
          "Built a private, editable webpage entry locally. Add the page title and author below.",
        );
        return;
      }
    }

    const currentRequest = ++requestId.current;
    setBusy(true);
    setError(null);
    setMessage(null);
    setHits([]);
    const result = await resolveCitation(input);
    if (currentRequest !== requestId.current) return;
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.bibtex) {
      applyBibtex(result.bibtex, "Metadata retrieved. Review the fields before exporting.");
      return;
    }
    if (result.hits?.length) {
      setHits(result.hits);
      setMessage(`${result.hits.length} possible matches found`);
      return;
    }
    setError("No matching reference was found. You can still enter the details manually.");
  };

  const selectHit = async (hit: CitationHit) => {
    const currentRequest = ++requestId.current;
    setBusy(true);
    setError(null);
    try {
      const result = await bibtexForHit(hit);
      if (currentRequest !== requestId.current) return;
      applyBibtex(result, "Reference selected. Review the fields before exporting.");
    } catch (caught) {
      if (currentRequest === requestId.current) {
        setError(caught instanceof Error ? caught.message : "Oleafly couldn't build this reference.");
      }
    } finally {
      if (currentRequest === requestId.current) setBusy(false);
    }
  };

  const addToBibliography = () => {
    if (!form.title.trim()) {
      setError("Add a title before adding this reference.");
      return;
    }
    const keys = new Set(inspection.findings.map((finding) => finding.key));
    const entry = formToBibtex(form, keys);
    setBibtex((current) => `${current.trim()}${current.trim() ? "\n\n" : ""}${entry}`);
    setForm(EMPTY_REFERENCE);
    setError(null);
    setMessage("Reference added to the bibliography");
  };

  const reset = () => {
    requestId.current += 1;
    setBusy(false);
    setError(null);
    setMessage(null);
    setHits([]);
    setQuery(content.queryExample);
    const nextForm = bibliographyMode ? EMPTY_REFERENCE : compareMode || id === "citation-generator" ? EXAMPLE_REFERENCE : EMPTY_REFERENCE;
    setForm(nextForm);
    setBibtex(bibliographyMode ? BIBLIOGRAPHY_EXAMPLE : compareMode || id === "citation-generator" ? formToBibtex(nextForm) : "");
  };

  const statusState = error ? "error" : busy ? "busy" : "ready";
  const statusText = error ? "Needs attention" : busy ? "Looking up metadata" : "Local formatter ready";

  return (
    <ToolPageShell
      page="reference"
      title={content.title}
      subtitle={content.subtitle}
      icon={catalog.icon}
      showTheme
      testId="reference-tool-view"
      status={<ToolStatus state={statusState}>{statusText}</ToolStatus>}
    >
      <ToolSplitView storageId={`reference-${id}`}>
        <ToolPane
          title={bibliographyMode ? "Build bibliography" : compareMode ? "BibTeX input" : "Reference details"}
          badge={bibliographyMode ? `${inspection.entries} entries` : "Local editing"}
          actions={
            <Button variant="ghost" size="sm" onClick={reset}>
              <RotateCcw className="size-3.5" /> Reset example
            </Button>
          }
        >
          {bibliographyMode ? (
            <>
              <div className="flex items-center border-b px-4 py-2">
                <ToolSegmentedControl
                  label="Bibliography input"
                  value={bibliographyInputMode}
                  onChange={setBibliographyInputMode}
                  options={[
                    { value: "fields", label: "Add reference" },
                    { value: "bibtex", label: "Edit BibTeX" },
                  ]}
                />
              </div>
              {bibliographyInputMode === "fields" ? (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <ReferenceFields form={form} onChange={setForm} />
                  <div className="flex justify-end border-t px-4 py-3">
                    <Button onClick={addToBibliography}><Plus className="size-4" /> Add to bibliography</Button>
                  </div>
                </div>
              ) : (
                <CodeField
                  value={bibtex}
                  onChange={(value) => { setBibtex(value); setError(null); }}
                  language={bibtexLanguage}
                  themeId={editorTheme}
                  placeholder="Paste one or more BibTeX entries…"
                  testId="bibliography-bibtex-input"
                  className="min-h-64 flex-1 overflow-auto text-xs [&_.cm-editor]:h-full"
                />
              )}
            </>
          ) : compareMode ? (
            <CodeField
              value={bibtex}
              onChange={(value) => { setBibtex(value); setError(null); }}
              language={bibtexLanguage}
              themeId={editorTheme}
              placeholder="Paste one BibTeX entry to compare styles…"
              testId="citation-styles-bibtex-input"
              className="min-h-64 flex-1 overflow-auto text-xs [&_.cm-editor]:h-full"
            />
          ) : (
            <>
              <div className="border-b p-4">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="reference-lookup-input">
                  {content.queryLabel}
                </label>
                <div className="mt-1.5 flex gap-2">
                  <Input
                    id="reference-lookup-input"
                    value={query}
                    placeholder={content.queryPlaceholder}
                    maxLength={2_048}
                    onChange={(event) => {
                      requestId.current += 1;
                      setQuery(event.target.value);
                      setBusy(false);
                      setError(null);
                      setMessage(null);
                      setHits([]);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void runLookup();
                    }}
                    data-testid="reference-lookup-input"
                  />
                  <Button onClick={() => void runLookup()} disabled={busy} data-testid="reference-lookup-button">
                    {busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                    {id === "url-to-bibtex" ? "Build" : "Look up"}
                  </Button>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  Formatting and manual editing stay on this device. Metadata lookup uses the relevant public catalog and needs a connection.
                </p>
                {message && <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300" role="status">{message}</p>}
                {error && <p className="mt-2 text-xs text-destructive" role="alert">{error}</p>}
              </div>
              <SearchResults hits={hits} onSelect={(hit) => void selectHit(hit)} />
              <div className="min-h-0 flex-1 overflow-y-auto">
                <ReferenceFields form={form} onChange={updateForm} />
              </div>
            </>
          )}
          {(bibliographyMode || compareMode) && error && (
            <p className="border-t px-4 py-3 text-xs text-destructive" role="alert">{error}</p>
          )}
          {(bibliographyMode || compareMode) && message && (
            <p className="border-t px-4 py-3 text-xs text-emerald-700 dark:text-emerald-300" role="status">{message}</p>
          )}
        </ToolPane>
        <ToolPane
          title={compareMode ? "Style comparison" : "Citation output"}
          badge={compareMode ? "8 styles" : CITATION_STYLES.find((candidate) => candidate.id === style)?.label}
          actions={compareMode ? (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" disabled={!bibtex} onClick={() => void copyText(bibtex, "BibTeX")}><Copy className="size-3.5" /> Copy BibTeX</Button>
              <Button variant="ghost" size="sm" disabled={!bibtex} onClick={() => void saveBibtex(bibtex)}><Download className="size-3.5" /> Save</Button>
            </div>
          ) : undefined}
        >
          {compareMode ? (
            <>
              <StyleComparison bibtex={bibtex} formattingError={formattingError} />
              <ValidationSummary bibtex={bibtex} />
            </>
          ) : (
            <ReferenceOutput
              bibtex={bibtex}
              style={style}
              setStyle={setStyle}
              mode={outputMode}
              setMode={setOutputMode}
              formattingError={formattingError}
            />
          )}
        </ToolPane>
      </ToolSplitView>
    </ToolPageShell>
  );
}

export function ReferenceToolView() {
  const id = useHomeViewStore((state) => state.activeReferenceTool);
  if (!id) return null;
  return <ReferenceWorkspace key={id} id={id} />;
}
