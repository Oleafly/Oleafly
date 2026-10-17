import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Copy, RefreshCw, ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/empty";
import { SectionHeading } from "@/components/ui/section-heading";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  formatSubmissionMetadata,
  hasSubmissionMetadata,
  type DocumentInsightsBase,
  type InsightEntry,
  type InsightsEngine,
  type SourceLocation,
} from "@/features/document-insights";
import { insightsEngineFor, loadDocumentInsights, type LoadedInsights } from "@/features/document-insights-load";
import { describeError } from "@/lib/app-error";
import { logError } from "@/lib/log";
import { openProjectLocation } from "@/lib/open-location";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useFilesStore } from "@/store/files";

type InsightTab = "overview" | "headings" | "figures" | "tables" | "equations" | "labels" | "citations" | "todos";
type EmptyTab = "headings" | "figures" | "tables" | "equations" | "citations";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; loaded: LoadedInsights }
  | { status: "error"; message: string };

const TABS: readonly InsightTab[] = ["overview", "headings", "figures", "tables", "equations", "labels", "citations", "todos"];

function labelText(engine: InsightsEngine, label: string): string {
  if (engine === "typst") return `<${label}>`;
  if (engine === "markdown") return `#${label}`;
  return label;
}

function SourceRow({
  location,
  onOpen,
  children,
  testId,
}: Readonly<{
  location: SourceLocation | null;
  onOpen: (location: SourceLocation) => void;
  children: ReactNode;
  testId?: string;
}>) {
  const { t } = useTranslation(["editor"]);
  const className = "flex w-full items-start gap-3 rounded-md px-2 py-1.5 text-left text-sm";
  if (!location) {
    return (
      <div data-testid={testId} className={cn(className, "text-muted-foreground")} title={t(($) => $.editor.typstInsights.notInSource)}>
        {children}
      </div>
    );
  }
  return (
    <button
      type="button"
      data-testid={testId}
      className={cn(className, "transition-colors hover:bg-accent/60 focus-visible:bg-accent/60")}
      title={t(($) => $.editor.typstInsights.openSource, { file: location.path, line: location.line })}
      onClick={() => onOpen(location)}
    >
      {children}
    </button>
  );
}

function Meta({ children, className }: Readonly<{ children: ReactNode; className?: string }>) {
  return <span className={cn("ml-auto shrink-0 font-mono text-[0.6875rem] tabular-nums text-muted-foreground", className)}>{children}</span>;
}

function EntryList({
  engine,
  entries,
  empty,
  onOpen,
}: Readonly<{ engine: InsightsEngine; entries: readonly InsightEntry[]; empty: string; onOpen: (location: SourceLocation) => void }>) {
  const { t } = useTranslation(["editor"]);
  if (entries.length === 0) return <EmptyState size="compact" className="py-10" description={empty} />;
  return (
    <ul className="space-y-0.5">
      {entries.map((entry) => (
        <li key={entry.id}>
          <SourceRow location={entry.location} onOpen={onOpen} testId="document-insight-entry">
            <span
              className={cn(
                "flex min-w-0 flex-1 items-baseline gap-2",
                entry.kind === "heading" && entry.level === 1 && "font-medium",
              )}
              style={entry.kind === "heading" ? { paddingLeft: `${Math.max(0, (entry.level ?? 1) - 1) * 14}px` } : undefined}
            >
              {entry.number && (
                <span className="shrink-0 font-mono text-[0.6875rem] tabular-nums text-muted-foreground">
                  {entry.kind === "equation" ? `(${entry.number})` : entry.number}
                </span>
              )}
              <span className={cn("min-w-0 truncate", entry.kind === "equation" && "font-mono text-xs")}>
                {entry.text || t(($) => $.editor.typstInsights.untitled)}
              </span>
            </span>
            {entry.label && <span className="shrink-0 font-mono text-[0.6875rem] text-muted-foreground">{labelText(engine, entry.label)}</span>}
            {!entry.numbered && entry.kind !== "heading" && <Meta>{t(($) => $.editor.typstInsights.unnumbered)}</Meta>}
            {entry.page !== null && <Meta>{t(($) => $.editor.typstInsights.page, { page: entry.page })}</Meta>}
          </SourceRow>
        </li>
      ))}
    </ul>
  );
}

function MetadataField({ label, value }: Readonly<{ label: string; value: string | null }>) {
  const { t } = useTranslation(["editor"]);
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 py-1 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 whitespace-pre-wrap break-words", value ? "select-text" : "text-muted-foreground/70")}>
        {value || t(($) => $.editor.typstInsights.metadata.missing)}
      </dd>
    </div>
  );
}

function CompileDiagnostics({ loaded, onOpen }: Readonly<{ loaded: LoadedInsights; onOpen: (location: SourceLocation) => void }>) {
  const { t } = useTranslation(["editor"]);
  if (loaded.engine !== "typst" || loaded.insights.compiled?.status !== "failed") return null;
  return (
    <ErrorState size="compact" message={t(($) => $.editor.typstInsights.compileFailed)}>
      <ul className="w-full space-y-0.5" data-testid="document-insights-diagnostics">
        {loaded.insights.compiled.diagnostics.map((diagnostic) => {
          const location = diagnostic.file && diagnostic.line
            ? { path: diagnostic.file, line: diagnostic.line, column: diagnostic.column ?? 1 }
            : null;
          return (
            <li key={`${diagnostic.file}:${diagnostic.line}:${diagnostic.column}:${diagnostic.message}`}>
              <SourceRow location={location} onOpen={onOpen}>
                <span className="min-w-0 flex-1 break-words">{diagnostic.message}</span>
                {location && <Meta>{`${location.path}:${location.line}`}</Meta>}
              </SourceRow>
            </li>
          );
        })}
      </ul>
    </ErrorState>
  );
}

function Overview({
  loaded,
  onOpen,
  onTab,
}: Readonly<{ loaded: LoadedInsights; onOpen: (location: SourceLocation) => void; onTab: (tab: InsightTab) => void }>) {
  const { t } = useTranslation(["editor"]);
  const { insights } = loaded;
  const { metadata } = insights;
  const unresolved = insights.citations.filter((citation) => citation.unresolved).length;
  const counts: [InsightTab, number][] = [
    ["headings", insights.headings.length],
    ["figures", insights.figures.length],
    ["tables", insights.tables.length],
    ["equations", insights.equations.length],
    ["labels", insights.labels.length],
    ["citations", insights.citations.length],
    ["todos", insights.todos.length],
  ];
  return (
    <div className="space-y-5">
      <CompileDiagnostics loaded={loaded} onOpen={onOpen} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {counts.map(([tab, count]) => (
          <button
            key={tab}
            type="button"
            className="rounded-md border px-3 py-2 text-left transition-colors hover:bg-accent/60 focus-visible:bg-accent/60"
            onClick={() => onTab(tab)}
          >
            <span className="block font-mono text-lg tabular-nums">{count}</span>
            <span className="block text-xs text-muted-foreground">{t(($) => $.editor.typstInsights.tabs[tab])}</span>
          </button>
        ))}
      </div>
      {unresolved > 0 && (
        <button
          type="button"
          data-testid="document-insights-unresolved"
          className="w-full rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left text-sm text-amber-800 transition-colors hover:bg-amber-500/15 focus-visible:bg-amber-500/15 dark:text-amber-300"
          onClick={() => onTab("citations")}
        >
          {t(($) => $.editor.documentInsights.unresolvedCount, { count: unresolved })}
        </button>
      )}
      <section className="space-y-2">
        <SectionHeading>{t(($) => $.editor.typstInsights.metadata.heading)}</SectionHeading>
        <dl data-testid="document-insights-metadata">
          <MetadataField label={t(($) => $.editor.typstInsights.metadata.title)} value={metadata.title} />
          <MetadataField label={t(($) => $.editor.typstInsights.metadata.authors)} value={metadata.authors.join(", ") || null} />
          <MetadataField label={t(($) => $.editor.typstInsights.metadata.keywords)} value={metadata.keywords.join(", ") || null} />
          <MetadataField label={t(($) => $.editor.typstInsights.metadata.date)} value={metadata.date} />
          <MetadataField label={t(($) => $.editor.typstInsights.metadata.abstract)} value={metadata.abstract} />
        </dl>
      </section>
    </div>
  );
}

function FooterNote({ loaded }: Readonly<{ loaded: LoadedInsights | null }>) {
  const { t } = useTranslation(["editor"]);
  if (!loaded) return null;
  if (loaded.engine === "typst") {
    const { compiled } = loaded.insights;
    if (!compiled) return null;
    return (
      <p>
        {t(($) => $.editor.typstInsights.versionNote, { version: compiled.typstVersion, method: compiled.method })}
        {compiled.status === "ready" && compiled.truncated ? ` ${t(($) => $.editor.typstInsights.truncated)}` : ""}
      </p>
    );
  }
  if (loaded.engine === "markdown") return <p>{t(($) => $.editor.documentInsights.sourceOrder)}</p>;
  if (loaded.numbers === "current") return <p>{t(($) => $.editor.documentInsights.numbersCurrent)}</p>;
  if (loaded.numbers === "stale") return <p>{t(($) => $.editor.documentInsights.numbersStale)}</p>;
  return <p>{t(($) => $.editor.documentInsights.numbersMissing)}</p>;
}

export function DocumentInsightsDialog({ onClose }: Readonly<{ onClose: () => void }>) {
  const { t } = useTranslation(["editor"]);
  const [engine] = useState(() => insightsEngineFor(useFilesStore.getState().engine));
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [tab, setTab] = useState<InsightTab>("overview");
  const [copyError, setCopyError] = useState<string | null>(null);
  const request = useRef(0);
  const typst = engine === "typst";

  const load = useCallback(async () => {
    const id = ++request.current;
    setState({ status: "loading" });
    try {
      if (!engine) throw new Error("no document engine");
      const loaded = await loadDocumentInsights(engine);
      if (id === request.current) setState({ status: "ready", loaded });
    } catch (error) {
      void logError("document insights", error);
      if (id !== request.current) return;
      let message: string;
      if (!useFilesStore.getState().projectId || !engine) {
        message = typst ? t(($) => $.editor.typstInsights.noProject) : t(($) => $.editor.documentInsights.noProject);
      } else message = describeError(error);
      setState({ status: "error", message });
    }
  }, [engine, t, typst]);

  useEffect(() => {
    void load();
    return () => {
      request.current += 1;
    };
  }, [load]);

  const openSource = (location: SourceLocation) => {
    onClose();
    void openProjectLocation({ path: location.path, line: location.line, column: location.column }, { pdfView: "editor" });
  };

  const loaded = state.status === "ready" ? state.loaded : null;
  const insights: DocumentInsightsBase | null = loaded?.insights ?? null;

  const copyMetadata = async () => {
    if (!insights) return;
    setCopyError(null);
    const text = formatSubmissionMetadata(insights.metadata, {
      title: t(($) => $.editor.typstInsights.metadata.title),
      authors: t(($) => $.editor.typstInsights.metadata.authors),
      keywords: t(($) => $.editor.typstInsights.metadata.keywords),
      abstract: t(($) => $.editor.typstInsights.metadata.abstract),
    });
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t(($) => $.editor.typstInsights.metadataCopied));
    } catch (error) {
      void logError("copy submission metadata", error);
      setCopyError(t(($) => $.editor.typstInsights.copyFailed));
    }
  };

  const count = (key: InsightTab): number | null => {
    if (!insights || key === "overview") return null;
    return insights[key].length;
  };

  const emptyText = (key: EmptyTab): string =>
    typst ? t(($) => $.editor.typstInsights.empty[key]) : t(($) => $.editor.documentInsights.empty[key]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-testid="document-insights-dialog" className="flex h-[min(44rem,88dvh)] max-w-4xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
          <div className="flex items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted">
              <ScanSearch aria-hidden className="size-4" />
            </div>
            <div className="space-y-1">
              <DialogTitle className="text-sm leading-tight">{t(($) => $.editor.typstInsights.title)}</DialogTitle>
              <DialogDescription className="text-xs">
                {typst ? t(($) => $.editor.typstInsights.description) : t(($) => $.editor.documentInsights.description)}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(value) => setTab(value as InsightTab)} className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b px-5 py-2">
            <TabsList size="sm" scrollable>
              {TABS.map((key) => (
                <TabsTrigger key={key} value={key}>
                  {t(($) => $.editor.typstInsights.tabs[key])}
                  {count(key) !== null && <span className="font-mono tabular-nums text-muted-foreground">{count(key)}</span>}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {state.status === "loading" && (
              <LoadingState
                label={typst ? t(($) => $.editor.typstInsights.loading) : t(($) => $.editor.documentInsights.loading)}
                testId="document-insights-loading"
              />
            )}
            {state.status === "error" && <ErrorState message={state.message} />}
            {loaded && insights && engine && (
              <>
                <TabsContent value="overview">
                  <Overview loaded={loaded} onOpen={openSource} onTab={setTab} />
                </TabsContent>
                <TabsContent value="headings">
                  <EntryList engine={engine} entries={insights.headings} empty={emptyText("headings")} onOpen={openSource} />
                </TabsContent>
                <TabsContent value="figures">
                  <EntryList engine={engine} entries={insights.figures} empty={emptyText("figures")} onOpen={openSource} />
                </TabsContent>
                <TabsContent value="tables">
                  <EntryList engine={engine} entries={insights.tables} empty={emptyText("tables")} onOpen={openSource} />
                </TabsContent>
                <TabsContent value="equations">
                  <EntryList engine={engine} entries={insights.equations} empty={emptyText("equations")} onOpen={openSource} />
                </TabsContent>
                <TabsContent value="labels">
                  {insights.labels.length === 0 ? (
                    <EmptyState size="compact" className="py-10" description={t(($) => $.editor.typstInsights.empty.labels)} />
                  ) : (
                    <ul className="space-y-0.5">
                      {insights.labels.map((label) => (
                        <li key={label.name}>
                          <SourceRow location={label.location} onOpen={openSource}>
                            <span className="min-w-0 flex-1 truncate font-mono text-xs">{labelText(engine, label.name)}</span>
                            <Meta>{t(($) => $.editor.typstInsights.labelKinds[label.kind])}</Meta>
                          </SourceRow>
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>
                <TabsContent value="citations">
                  {insights.citations.length === 0 ? (
                    <EmptyState size="compact" className="py-10" description={emptyText("citations")} />
                  ) : (
                    <ul className="space-y-0.5">
                      {insights.citations.map((citation) => (
                        <li key={citation.key}>
                          <SourceRow location={citation.location} onOpen={openSource} testId="document-insight-citation">
                            <span className="min-w-0 flex-1 truncate font-mono text-xs">{citation.key}</span>
                            {citation.unresolved && (
                              <Meta className="font-sans text-amber-700 dark:text-amber-300">{t(($) => $.editor.documentInsights.unresolved)}</Meta>
                            )}
                            <Meta className={citation.unresolved ? "ml-0" : undefined}>
                              {t(($) => $.editor.typstInsights.cited, { count: citation.count })}
                            </Meta>
                          </SourceRow>
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>
                <TabsContent value="todos">
                  {insights.todos.length === 0 ? (
                    <EmptyState size="compact" className="py-10" description={t(($) => $.editor.typstInsights.empty.todos)} />
                  ) : (
                    <ul className="space-y-0.5">
                      {insights.todos.map((todo) => (
                        <li key={`${todo.location.path}:${todo.location.line}:${todo.location.column}`}>
                          <SourceRow location={todo.location} onOpen={openSource}>
                            <span className="min-w-0 flex-1 break-words">{todo.text}</span>
                            <Meta>{`${todo.location.path}:${todo.location.line}`}</Meta>
                          </SourceRow>
                        </li>
                      ))}
                    </ul>
                  )}
                </TabsContent>
              </>
            )}
          </div>
        </Tabs>
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t px-5 py-3">
          <div className="min-w-0 flex-1 text-xs text-muted-foreground">
            {copyError ? <p role="alert" className="text-destructive">{copyError}</p> : <FooterNote loaded={loaded} />}
          </div>
          <Button type="button" variant="outline" size="sm" disabled={state.status === "loading"} onClick={() => void load()}>
            <RefreshCw aria-hidden className="size-3.5" /> {t(($) => $.editor.typstInsights.refresh)}
          </Button>
          <Button
            type="button"
            size="sm"
            data-testid="document-insights-copy-metadata"
            disabled={!insights || !hasSubmissionMetadata(insights.metadata)}
            onClick={() => void copyMetadata()}
          >
            <Copy aria-hidden className="size-3.5" /> {t(($) => $.editor.typstInsights.copyMetadata)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
