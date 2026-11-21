import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookPlus } from "lucide-react";
import { foldLatinDiacritics, slugifyFigureName } from "@oleafly/latex";
import {
  type ChapterClashChoice,
  type ChapterImportPlan,
  planChapterImport,
} from "@oleafly/editor/chapter-import";
import { projectEngine } from "@/components/library/project-search";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { DetailList } from "@/components/ui/detail-list";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LoadingState } from "@/components/ui/empty";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input, LITERAL_INPUT } from "@/components/ui/input";
import { SectionHeading } from "@/components/ui/section-heading";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  type ChapterImportOutcome,
  loadPaper,
  loadThesis,
  type PaperSnapshot,
  type ThesisSnapshot,
  writeChapterImport,
} from "@/features/chapter-import";
import { logError } from "@/lib/log";
import { readOnlyEditMessage } from "@/lib/read-only-files";
import { useChapterImportStore } from "@/store/chapter-import";
import { useFilesStore } from "@/store/files";

interface Finished {
  readonly plan: ChapterImportPlan;
  readonly result: ChapterImportOutcome;
  readonly main: string;
}

function ManualSteps({ plan }: Readonly<{ plan: ChapterImportPlan }>) {
  const { t } = useTranslation(["editor"]);
  return (
    <>
      {plan.packages.length > 0 && (
        <section className="space-y-2">
          <SectionHeading>{t(($) => $.editor.chapterImport.packages)}</SectionHeading>
          <p className="text-xs text-muted-foreground">{t(($) => $.editor.chapterImport.packagesHint)}</p>
          <CodeBlock code={plan.packages.map((entry) => entry.line).join("\n")} data-testid="chapter-import-packages" />
        </section>
      )}
      {plan.bibliographies.length > 0 && (
        <section className="space-y-2">
          <SectionHeading>{t(($) => $.editor.chapterImport.bibliographies)}</SectionHeading>
          <p className="text-xs text-muted-foreground">{t(($) => $.editor.chapterImport.bibliographiesHint)}</p>
          <CodeBlock code={plan.bibliographies.join("\n")} />
        </section>
      )}
    </>
  );
}

function Summary({ finished }: Readonly<{ finished: Finished }>) {
  const { t } = useTranslation(["editor"]);
  const { plan, result, main } = finished;
  return (
    <div className="space-y-5" data-testid="chapter-import-summary">
      <p className="text-sm">
        {t(($) => $.editor.chapterImport.done, { count: result.written.length, root: plan.root })}
      </p>
      {plan.lines.length > 0 && (
        <section className="space-y-2">
          {result.mainUpdated ? (
            <p className="text-xs text-muted-foreground">{t(($) => $.editor.chapterImport.linesAdded, { path: main })}</p>
          ) : (
            <InlineAlert>{t(($) => $.editor.chapterImport.linesByHand, { path: main })}</InlineAlert>
          )}
          <CodeBlock code={plan.lines.join("\n")} />
        </section>
      )}
      <ManualSteps plan={plan} />
    </div>
  );
}

function Preview({
  plan,
  slug,
  setPrefix,
  setChoice,
  disabled,
}: Readonly<{
  plan: ChapterImportPlan;
  slug: string;
  setPrefix: (prefix: boolean) => void;
  setChoice: (name: string, choice: ChapterClashChoice) => void;
  disabled: boolean;
}>) {
  const { t } = useTranslation(["editor"]);
  const detail = (from: string | null, generated: boolean) => {
    if (generated) return t(($) => $.editor.chapterImport.chapterFile);
    if (from === null) return t(($) => $.editor.chapterImport.macrosFile, { count: plan.definitions });
    return t(($) => $.editor.chapterImport.copiedFrom, { path: from });
  };
  const items = [
    ...plan.files.map((file, index) => ({ key: file.path, title: file.path, detail: detail(file.from, index === 0) })),
    ...plan.assets.map((asset) => ({ key: asset.to, title: asset.to, detail: detail(asset.from, false) })),
  ];
  const labelHint = plan.labels.duplicates.length > 0
    ? t(($) => $.editor.chapterImport.prefixHint, { count: plan.labels.duplicates.length })
    : t(($) => $.editor.chapterImport.prefixHintNone);
  return (
    <div className="space-y-5" data-testid="chapter-import-preview">
      {plan.blockers.map((blocker) => (
        <InlineAlert key={blocker} bordered>
          {t(($) => $.editor.chapterImport.blockers[blocker], { root: plan.root })}
        </InlineAlert>
      ))}
      <section>
        <SectionHeading>{t(($) => $.editor.chapterImport.files, { count: items.length })}</SectionHeading>
        <DetailList items={items} testId="chapter-import-files" />
      </section>
      {plan.clashes.length > 0 && (
        <section className="space-y-2">
          <SectionHeading>{t(($) => $.editor.chapterImport.clashes)}</SectionHeading>
          <p className="text-xs text-muted-foreground">{t(($) => $.editor.chapterImport.clashHint)}</p>
          <ul className="space-y-2">
            {plan.clashes.map((clash) => (
              <li key={clash.name} className="space-y-2 rounded-md border p-3 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <code className="font-medium">{clash.name}</code>
                  <Select
                    value={clash.choice}
                    disabled={disabled}
                    onValueChange={(value) => setChoice(clash.name, value === "keep" ? "keep" : "rename")}
                  >
                    <SelectTrigger aria-label={t(($) => $.editor.chapterImport.clashChoice, { name: clash.name })} className="h-8 w-60 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rename">{t(($) => $.editor.chapterImport.rename, { name: clash.renamed })}</SelectItem>
                      <SelectItem value="keep">{t(($) => $.editor.chapterImport.keep)}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <dt className="text-muted-foreground">{t(($) => $.editor.chapterImport.paperVersion)}</dt>
                  <dd><code className="select-text break-all">{clash.paper}</code></dd>
                  <dt className="text-muted-foreground">{t(($) => $.editor.chapterImport.thesisVersion)}</dt>
                  <dd><code className="select-text break-all">{clash.thesis ?? t(($) => $.editor.chapterImport.builtIn)}</code></dd>
                </dl>
              </li>
            ))}
          </ul>
        </section>
      )}
      {plan.labels.count > 0 && (
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <label htmlFor="chapter-import-prefix" className="text-sm">
              {t(($) => $.editor.chapterImport.prefixLabels, { prefix: `${slug}:` })}
            </label>
            <p className="text-xs text-muted-foreground">{labelHint}</p>
          </div>
          <Switch id="chapter-import-prefix" checked={plan.labels.prefix} disabled={disabled} onCheckedChange={setPrefix} />
        </div>
      )}
      <ManualSteps plan={plan} />
      {plan.unresolved.length > 0 && (
        <section className="space-y-2">
          <SectionHeading>{t(($) => $.editor.chapterImport.unresolved)}</SectionHeading>
          <p className="text-xs text-muted-foreground">{t(($) => $.editor.chapterImport.unresolvedHint)}</p>
          <CodeBlock code={plan.unresolved.join("\n")} />
        </section>
      )}
      {plan.lines.length > 0 && (
        <section className="space-y-2">
          <SectionHeading>{t(($) => $.editor.chapterImport.lines)}</SectionHeading>
          <CodeBlock code={plan.lines.join("\n")} data-testid="chapter-import-lines" />
        </section>
      )}
    </div>
  );
}

export function ChapterImportDialog() {
  const { t } = useTranslation(["editor"]);
  const open = useChapterImportStore((state) => state.open);
  const setOpen = useChapterImportStore((state) => state.setOpen);
  const projects = useFilesStore((state) => state.projects);
  const projectId = useFilesStore((state) => state.projectId);
  const [thesis, setThesis] = useState<ThesisSnapshot | null>(null);
  const [paperId, setPaperId] = useState("");
  const [paper, setPaper] = useState<PaperSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [slug, setSlug] = useState("");
  const [prefix, setPrefix] = useState<boolean | undefined>(undefined);
  const [choices, setChoices] = useState<Record<string, ChapterClashChoice>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState<Finished | null>(null);
  const thesisRequest = useRef(0);
  const paperRequest = useRef(0);

  const papers = useMemo(
    () => projects.filter((project) => project.id !== projectId && project.kind !== "note" && projectEngine(project) === "latex"),
    [projects, projectId],
  );

  useEffect(() => {
    thesisRequest.current += 1;
    paperRequest.current += 1;
    setThesis(null);
    setPaperId("");
    setPaper(null);
    setLoading(false);
    setSlug("");
    setPrefix(undefined);
    setChoices({});
    setBusy(false);
    setError(null);
    setFinished(null);
    if (!open) return;
    const request = thesisRequest.current;
    void useFilesStore.getState().refreshProjects().catch((reason: unknown) => logError("chapter import projects", reason));
    loadThesis()
      .then((snapshot) => {
        if (request === thesisRequest.current) setThesis(snapshot);
      })
      .catch((reason: unknown) => {
        void logError("chapter import thesis", reason);
        if (request === thesisRequest.current) setError(t(($) => $.editor.chapterImport.loadFailed));
      });
  }, [open, t]);

  const plan = useMemo(
    () => (thesis && paper ? planChapterImport({ thesis, paper, slug, prefixLabels: prefix, clashes: choices }) : null),
    [thesis, paper, slug, prefix, choices],
  );

  const choosePaper = async (id: string) => {
    const project = papers.find((entry) => entry.id === id);
    if (!project) return;
    const request = ++paperRequest.current;
    setPaperId(id);
    setPaper(null);
    setError(null);
    setLoading(true);
    setSlug(slugifyFigureName(foldLatinDiacritics(project.name)));
    setPrefix(undefined);
    setChoices({});
    try {
      const snapshot = await loadPaper(project);
      if (request === paperRequest.current) setPaper(snapshot);
    } catch (reason) {
      void logError("chapter import paper", reason);
      if (request === paperRequest.current) setError(t(($) => $.editor.chapterImport.loadFailed));
    } finally {
      if (request === paperRequest.current) setLoading(false);
    }
  };

  const add = async () => {
    if (!thesis || !paper || !plan || plan.blockers.length > 0 || busy) return;
    const readOnly = readOnlyEditMessage(thesis.main);
    if (readOnly) {
      setError(readOnly);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const fresh = await loadThesis();
      if (!fresh || fresh.projectId !== thesis.projectId) throw new Error("The open project changed.");
      const next = planChapterImport({ thesis: fresh, paper, slug, prefixLabels: prefix, clashes: choices });
      if (next.blockers.length > 0) {
        setThesis(fresh);
        return;
      }
      const result = await writeChapterImport(fresh, paper, next);
      setFinished({ plan: next, result, main: fresh.main });
    } catch (reason) {
      void logError("add chapter from project", reason);
      setError(t(($) => $.editor.chapterImport.failed, { root: plan.root }));
    } finally {
      setBusy(false);
    }
  };

  const openChapter = () => {
    if (!finished) return;
    setOpen(false);
    void useFilesStore.getState().openFile(`${finished.plan.root}/chapter.tex`);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) setOpen(next);
      }}
    >
      <DialogContent
        data-testid="chapter-import-dialog"
        closeDisabled={busy}
        className="flex max-h-[85dvh] max-w-2xl flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
          <div className="flex items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted">
              <BookPlus aria-hidden className="size-4" />
            </div>
            <div className="space-y-1">
              <DialogTitle className="text-sm leading-tight">{t(($) => $.editor.chapterImport.title)}</DialogTitle>
              <DialogDescription className="text-xs">{t(($) => $.editor.chapterImport.description)}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          {finished ? (
            <Summary finished={finished} />
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <label htmlFor="chapter-import-paper" className="text-xs text-muted-foreground">
                    {t(($) => $.editor.chapterImport.paper)}
                  </label>
                  <Select value={paperId} disabled={busy || papers.length === 0} onValueChange={(id) => void choosePaper(id)}>
                    <SelectTrigger id="chapter-import-paper">
                      <SelectValue placeholder={t(($) => $.editor.chapterImport.choosePaper)} />
                    </SelectTrigger>
                    <SelectContent>
                      {papers.map((project) => (
                        <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {papers.length === 0 && <p className="text-xs text-muted-foreground">{t(($) => $.editor.chapterImport.noPapers)}</p>}
                </div>
                <div className="grid gap-2">
                  <label htmlFor="chapter-import-slug" className="text-xs text-muted-foreground">
                    {t(($) => $.editor.chapterImport.folder)}
                  </label>
                  <Input
                    id="chapter-import-slug"
                    {...LITERAL_INPUT}
                    value={slug}
                    disabled={!paper || busy}
                    onChange={(event) => setSlug(event.target.value)}
                  />
                  {plan && <p className="break-all text-xs text-muted-foreground">{t(($) => $.editor.chapterImport.folderHint, { root: plan.root })}</p>}
                </div>
              </div>
              {(loading || (paper && !thesis && !error)) && <LoadingState size="compact" label={t(($) => $.editor.chapterImport.loading)} />}
              {plan && (
                <Preview
                  plan={plan}
                  slug={slug.trim()}
                  disabled={busy}
                  setPrefix={setPrefix}
                  setChoice={(name, choice) => setChoices((current) => ({ ...current, [name]: choice }))}
                />
              )}
            </>
          )}
          {error && <InlineAlert bordered>{error}</InlineAlert>}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3">
          {finished ? (
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                {t(($) => $.editor.chapterImport.close)}
              </Button>
              <Button type="button" size="sm" onClick={openChapter}>
                {t(($) => $.editor.chapterImport.openChapter)}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setOpen(false)}>
                {t(($) => $.editor.chapterImport.cancel)}
              </Button>
              <Button
                type="button"
                size="sm"
                data-testid="chapter-import-add"
                disabled={busy || !plan || plan.blockers.length > 0}
                onClick={() => void add()}
              >
                {busy && <Spinner />}
                {busy ? t(($) => $.editor.chapterImport.adding) : t(($) => $.editor.chapterImport.add)}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
