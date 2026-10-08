import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, AlertTriangle, CheckCircle2, FileCode2, FolderOpen } from "lucide-react";
import { ModalShell } from "@/components/ui/modal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingState } from "@/components/ui/empty";
import { openProjectLocation } from "@/lib/open-location";
import { logError } from "@/lib/log";
import { objectKey } from "@/lib/react-key";
import { useFilesStore } from "@/store/files";
import { useTypstMigrationStore } from "@/store/typst-migration";
import type {
  MigrationCompileProblem,
  MigrationErrorCode,
  MigrationNote,
  MigrationReport,
} from "@/features/latex-to-typst-migration";

async function openMigratedProject(report: MigrationReport, problem?: MigrationCompileProblem): Promise<void> {
  const files = useFilesStore.getState();
  if (files.projectId !== report.projectId) {
    await files.refreshProjects();
    await useFilesStore.getState().openProject(report.projectId);
  }
  if (problem?.file) await openProjectLocation({ path: problem.file, line: problem.line ?? 1 });
}

function Section({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <section className="mt-4">
      <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function NoteText({ note }: Readonly<{ note: MigrationNote }>) {
  const { t } = useTranslation(["shell"]);
  const detail = note.detail;
  switch (note.kind) {
    case "missingInclude":
      return <>{t(($) => $.shell.typstMigration.notes.missingInclude, { detail })}</>;
    case "lostInclude":
      return <>{t(($) => $.shell.typstMigration.notes.lostInclude, { detail })}</>;
    case "missingImage":
      return <>{t(($) => $.shell.typstMigration.notes.missingImage, { detail })}</>;
    case "unsupportedImage":
      return <>{t(($) => $.shell.typstMigration.notes.unsupportedImage, { detail })}</>;
    case "math":
      return <>{t(($) => $.shell.typstMigration.notes.math, { detail })}</>;
    case "bibliographyStyle":
      return <>{t(($) => $.shell.typstMigration.notes.bibliographyStyle, { detail })}</>;
    case "skippedFile":
      return <>{t(($) => $.shell.typstMigration.notes.skippedFile, { detail })}</>;
    case "unreadableFile":
      return <>{t(($) => $.shell.typstMigration.notes.unreadableFile, { detail })}</>;
    case "equationLabel":
      return <>{t(($) => $.shell.typstMigration.notes.equationLabel, { detail })}</>;
    case "pandoc":
      return <span className="font-mono text-[11px]">{detail}</span>;
  }
}

function ConvertedSummary({ report }: Readonly<{ report: MigrationReport }>) {
  const { t } = useTranslation(["shell"]);
  const converted = report.converted;
  const rows = [
    t(($) => $.shell.typstMigration.report.sources, { count: converted.sources.length }),
    t(($) => $.shell.typstMigration.report.figures, { count: converted.figures }),
    t(($) => $.shell.typstMigration.report.tables, { count: converted.tables }),
    t(($) => $.shell.typstMigration.report.equations, { count: converted.equations }),
    t(($) => $.shell.typstMigration.report.references, { count: converted.references }),
    ...(converted.mathFixed > 0
      ? [t(($) => $.shell.typstMigration.report.mathFixed, { count: converted.mathFixed })]
      : []),
    t(($) => $.shell.typstMigration.report.copied, { count: converted.copied }),
    ...(converted.style ? [t(($) => $.shell.typstMigration.report.style, { style: converted.style })] : []),
  ];
  return (
    <>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
        {rows.map((row) => (
          <li key={row} className="flex items-center gap-1.5">
            <CheckCircle2 className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
            {row}
          </li>
        ))}
      </ul>
      <ul className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
        {converted.sources.map((source) => (
          <li key={source.target} className="truncate font-mono">
            {t(($) => $.shell.typstMigration.report.mapping, { source: source.source, target: source.target })}
          </li>
        ))}
      </ul>
    </>
  );
}

function AttentionList({ notes }: Readonly<{ notes: readonly MigrationNote[] }>) {
  const { t } = useTranslation(["shell"]);
  if (notes.length === 0) {
    return <p className="text-xs text-muted-foreground">{t(($) => $.shell.typstMigration.report.noAttention)}</p>;
  }
  return (
    <ul className="space-y-1" data-testid="typst-migration-attention">
      {notes.map((note) => (
        <li key={objectKey(note, "migration-note")} className="flex items-start gap-2 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0">
            <div className="break-words">
              <NoteText note={note} />
            </div>
            {note.source && (
              <div className="text-[11px] text-muted-foreground">
                {t(($) => $.shell.typstMigration.report.location, {
                  file: note.source.file,
                  line: note.source.line,
                })}
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function ProblemList({ report, onOpen }: Readonly<{ report: MigrationReport; onOpen: (problem: MigrationCompileProblem) => void }>) {
  const { t } = useTranslation(["shell"]);
  const problems = report.compile?.problems ?? [];
  if (problems.length === 0) return null;
  return (
    <Section title={t(($) => $.shell.typstMigration.report.problems)}>
      <ul className="space-y-1" data-testid="typst-migration-problems">
        {problems.map((problem) => {
          const linkable = problem.file !== null && report.files.includes(problem.file);
          const label = problem.file
            ? t(($) => $.shell.typstMigration.report.location, { file: problem.file, line: problem.line ?? 1 })
            : t(($) => $.shell.typstMigration.report.noLocation);
          const Icon = problem.severity === "error" ? AlertCircle : AlertTriangle;
          return (
            <li key={objectKey(problem, "migration-problem")}>
              <button
                type="button"
                disabled={!linkable}
                onClick={() => onOpen(problem)}
                aria-label={
                  linkable
                    ? t(($) => $.shell.typstMigration.report.openAt, { file: problem.file, line: problem.line ?? 1 })
                    : undefined
                }
                className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent disabled:hover:bg-transparent"
              >
                <Icon
                  className={
                    problem.severity === "error"
                      ? "mt-0.5 size-3.5 shrink-0 text-destructive"
                      : "mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400"
                  }
                />
                <span className="min-w-0">
                  <span className="block break-words">{problem.message}</span>
                  <span className={linkable ? "block text-[11px] text-primary" : "block text-[11px] text-muted-foreground"}>
                    {label}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function CompileSummary({ report }: Readonly<{ report: MigrationReport }>) {
  const { t } = useTranslation(["shell"]);
  if (!report.compile) {
    return <>{t(($) => $.shell.typstMigration.report.compileUnavailable, { detail: report.compileFailure ?? "" })}</>;
  }
  if (report.compile.ok) return <>{t(($) => $.shell.typstMigration.report.compiled)}</>;
  const errors = report.compile.problems.filter((problem) => problem.severity === "error").length;
  return <>{t(($) => $.shell.typstMigration.report.compileFailed, { count: Math.max(errors, 1) })}</>;
}

function ReportView({ report, onOpen }: Readonly<{ report: MigrationReport; onOpen: (problem?: MigrationCompileProblem) => void }>) {
  const { t } = useTranslation(["shell"]);
  const ok = report.compile?.ok === true;
  return (
    <div data-testid="typst-migration-report">
      <div
        className={
          ok
            ? "flex items-start gap-2 rounded-md bg-emerald-500/10 px-2.5 py-2 text-sm"
            : "flex items-start gap-2 rounded-md bg-amber-500/10 px-2.5 py-2 text-sm"
        }
      >
        {ok ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        )}
        <div>
          <p className="font-medium">{t(($) => $.shell.typstMigration.report.created, { name: report.projectName })}</p>
          <p className="text-xs text-muted-foreground">
            <CompileSummary report={report} />
          </p>
        </div>
      </div>
      <Section title={t(($) => $.shell.typstMigration.report.converted)}>
        <ConvertedSummary report={report} />
      </Section>
      <Section title={t(($) => $.shell.typstMigration.report.attention)}>
        <AttentionList notes={report.attention} />
      </Section>
      <ProblemList report={report} onOpen={onOpen} />
    </div>
  );
}

export function TypstMigrationDialog() {
  const { t } = useTranslation(["common", "shell"]);
  const open = useTypstMigrationStore((state) => state.open);
  const phase = useTypstMigrationStore((state) => state.phase);
  const close = useTypstMigrationStore((state) => state.close);
  const start = useTypstMigrationStore((state) => state.start);
  const projectName = useFilesStore((state) => state.projectName);
  const latex = useFilesStore((state) => state.engine.capabilities.formatting_profile === "latex");
  const [name, setName] = useState("");

  useEffect(() => {
    if (open && phase.kind === "idle") {
      setName(t(($) => $.shell.typstMigration.defaultName, { name: projectName || "Oleafly" }));
    }
  }, [open, phase.kind, projectName, t]);

  if (!open) return null;

  const openReport = (report: MigrationReport, problem?: MigrationCompileProblem) => {
    close();
    void openMigratedProject(report, problem).catch((error) => void logError("open migrated project", error));
  };

  const failureMessage = (code: MigrationErrorCode | null, message: string): string => {
    if (code === "pandoc") return t(($) => $.shell.typstMigration.errors.pandoc);
    if (code === "noMain") return t(($) => $.shell.typstMigration.errors.noMain);
    if (code === "emptyOutput") return t(($) => $.shell.typstMigration.errors.emptyOutput);
    return t(($) => $.shell.typstMigration.errors.failed, { detail: message });
  };

  const stepLabel = (step: string): string => {
    if (step === "converting") return t(($) => $.shell.typstMigration.progress.converting);
    if (step === "creating") return t(($) => $.shell.typstMigration.progress.creating);
    if (step === "compiling") return t(($) => $.shell.typstMigration.progress.compiling);
    return t(($) => $.shell.typstMigration.progress.reading);
  };

  const body = () => {
    if (phase.kind === "running") {
      return <LoadingState className="py-6" label={stepLabel(phase.step)} />;
    }
    if (phase.kind === "done") {
      return <ReportView report={phase.report} onOpen={(problem) => openReport(phase.report, problem)} />;
    }
    return (
      <div>
        <p className="text-sm">{t(($) => $.shell.typstMigration.intro)}</p>
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {[
            t(($) => $.shell.typstMigration.points.text),
            t(($) => $.shell.typstMigration.points.files),
            t(($) => $.shell.typstMigration.points.bibliography),
            t(($) => $.shell.typstMigration.points.compile),
          ].map((point) => (
            <li key={point} className="flex items-start gap-1.5">
              <CheckCircle2 className="mt-0.5 size-3 shrink-0" />
              {point}
            </li>
          ))}
        </ul>
        <label htmlFor="typst-migration-name" className="mt-4 block text-xs font-medium">
          {t(($) => $.shell.typstMigration.nameLabel)}
        </label>
        <Input
          id="typst-migration-name"
          data-modal-initial-focus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && name.trim() && latex) void start(name.trim());
          }}
          className="mt-1 h-8 text-sm"
        />
        {!latex && <p className="mt-2 text-xs text-destructive">{t(($) => $.shell.typstMigration.notLatex)}</p>}
        {phase.kind === "failed" && (
          <div className="mt-3 flex select-text items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>{failureMessage(phase.code, phase.message)}</span>
          </div>
        )}
      </div>
    );
  };

  const footer = () => {
    if (phase.kind === "done") {
      return (
        <>
          <Button variant="outline" size="sm" onClick={close}>
            {t(($) => $.common.actions.close)}
          </Button>
          <Button size="sm" onClick={() => openReport(phase.report)}>
            <FolderOpen data-icon="inline-start" />
            {t(($) => $.shell.typstMigration.report.open)}
          </Button>
        </>
      );
    }
    return (
      <>
        <Button variant="outline" size="sm" onClick={close}>
          {phase.kind === "running" ? t(($) => $.common.actions.close) : t(($) => $.common.actions.cancel)}
        </Button>
        <Button
          size="sm"
          disabled={phase.kind === "running" || !name.trim() || !latex}
          onClick={() => void start(name.trim())}
        >
          {phase.kind === "failed" ? t(($) => $.shell.typstMigration.retry) : t(($) => $.shell.typstMigration.convert)}
        </Button>
      </>
    );
  };

  return (
    <ModalShell
      open
      onClose={close}
      closeLabel={t(($) => $.shell.typstMigration.closeLabel)}
      align="top"
      labelledBy="typst-migration-title"
      className="flex max-h-[80vh] w-[38rem] max-w-[92vw] flex-col"
    >
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <FileCode2 className="size-4 text-muted-foreground" />
        <span id="typst-migration-title" className="text-sm font-semibold">
          {t(($) => $.shell.typstMigration.title)}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">{body()}</div>
      <div className="flex justify-end gap-2 border-t px-4 py-3">{footer()}</div>
    </ModalShell>
  );
}
