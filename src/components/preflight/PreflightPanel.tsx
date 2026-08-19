import { memo, useMemo, useState } from "react";
import {
  Accessibility,
  ChevronDown,
  Eye,
  FileCheck2,
  FileSearch,
  Info,
  Link2,
  Play,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { usePreflightStore } from "@/store/preflight";
import { useFilesStore } from "@/store/files";
import { useCompileStore } from "@/store/compile";
import {
  CHECK_IDS,
  detectSubmissionProfile,
  findingAppliesTo,
  looksLikeResumeSource,
  SUBMISSION_PROFILES,
  SUBMISSION_PROFILE_IDS,
} from "@oleafly/preflight";
import type { CheckId, Finding, PreflightReport, Severity, SubmissionProfileId } from "@oleafly/preflight";
import { ScoreRing } from "./ScoreRing";
import { FindingRow } from "./FindingRow";
import { ReaderViewDialog } from "./ReaderViewDialog";
import { AtsCard } from "./AtsCard";
import { PrepExport } from "./PrepExport";
import { cn } from "@/lib/utils";
import { Popover } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

type Flags = Record<CheckId, boolean>;

const SEV_ORDER: Severity[] = ["error", "warning", "info"];

const CHECKS: {
  id: CheckId;
  label: string;
  icon: typeof FileSearch;
  who: string;
  info: string;
  detail: string;
}[] = [
  {
    id: "compile",
    label: "Compile & layout",
    icon: FileCheck2,
    who: "For every final document",
    info: "Build errors, unresolved references, missing glyphs, and page-layout problems.",
    detail:
      "Inspects the latest compiler log and PDF for failed builds, unresolved references, missing glyphs, overfull or clipped content, stale rerun warnings, and mixed page sizes.",
  },
  {
    id: "submission",
    label: "Submission readiness",
    icon: Send,
    who: "For conferences, journals, preprints, and theses",
    info: "Publication-profile rules and files that should not ship in the source package.",
    detail:
      "Applies a publication profile to the complete project: official document class, portable source paths, figure formats, abstract and keywords, PDF restrictions, captions, and clean source packaging.",
  },
  {
    id: "ats",
    label: "ATS readiness",
    icon: FileSearch,
    who: "For resumes and CVs",
    info: "The contact details and sections a resume parser can recover.",
    detail:
      "Simulates what an Applicant Tracking System (Workday, Taleo, Greenhouse) extracts from your PDF, and flags layout and formatting that scrambles it. Not relevant for research papers.",
  },
  {
    id: "a11y",
    label: "Accessibility",
    icon: Accessibility,
    who: "For research, government, and published PDFs",
    info: "Reading order, document metadata, tags, alt text, and selectable text.",
    detail:
      "Checks screen-reader readiness against Section 508 / WCAG: missing alt text, document language, reading order, and whether the PDF is tagged. Optional for resumes.",
  },
  {
    id: "refs",
    label: "References & assets",
    icon: Link2,
    who: "For research and multi-file documents",
    info: "Broken citations, duplicate labels, incomplete bibliography entries, and missing assets.",
    detail:
      "Finds undefined citations and cross-references, duplicate labels, and missing figure or included files, before they break your PDF at submission.",
  },
  {
    id: "privacy",
    label: "Privacy & blind review",
    icon: ShieldAlert,
    who: "Before sharing source or submitting anonymously",
    info: "Secrets, draft notes, sensitive files, and identity leaks during blind review.",
    detail:
      "Finds credentials, private keys, internal comments, draft markup, sensitive project files, author metadata, and identity leaks in anonymous-review submissions.",
  },
];

const SCORE_LABEL: Record<CheckId, string> = {
  ats: "ATS",
  compile: "Build",
  a11y: "Access",
  refs: "Refs",
  submission: "Submit",
  privacy: "Privacy",
};
function includes(f: Finding, shown: Flags): boolean {
  return CHECK_IDS.some((id) => shown[id] && findingAppliesTo(f, id));
}
const isOutputFinding = (f: Finding) =>
  f.id.startsWith("pdf-") ||
  f.id.startsWith("output-") ||
  f.id.startsWith("ats-") ||
  f.id.startsWith("compile-");
const bySeverity = (f: Finding[]) => SEV_ORDER.flatMap((sev) => f.filter((x) => x.severity === sev));

export function PreflightPanel() {
  // Narrow selectors so unrelated store writes do not re-render the whole panel.
  const report = usePreflightStore((s) => s.report);
  const pageText = usePreflightStore((s) => s.pageText);
  const running = usePreflightStore((s) => s.running);
  const showReader = usePreflightStore((s) => s.showReader);
  const error = usePreflightStore((s) => s.error);
  const toggleReader = usePreflightStore((s) => s.toggleReader);
  const run = usePreflightStore((s) => s.run);
  const ran = usePreflightStore((s) => s.ran);
  const storedEnabled = usePreflightStore((s) => s.enabled);
  const storedOpen = usePreflightStore((s) => s.open);
  const setRan = usePreflightStore((s) => s.setRan);
  const setEnabled = usePreflightStore((s) => s.setEnabled);
  const setOpen = usePreflightStore((s) => s.setOpen);
  const storedSubmissionProfile = usePreflightStore((s) => s.submissionProfile);
  const setSubmissionProfile = usePreflightStore((s) => s.setSubmissionProfile);
  const anonymousReview = usePreflightStore((s) => s.anonymousReview);
  const setAnonymousReview = usePreflightStore((s) => s.setAnonymousReview);

  // Keyed on the main document PATH (not its content), reading a content snapshot
  // imperatively. A successful compile is the low-frequency checkpoint that
  // refreshes the suggestion after edits, without re-running whole-document
  // resume detection on every keystroke.
  const mainDoc = useFilesStore((s) => s.mainDoc);
  const lastCompiledAt = useCompileStore((s) => s.lastCompiledAt);
  const engineLabel = useFilesStore((s) => s.engine.label);
  const sourcePreflight = useFilesStore((s) => s.engine.capabilities.source_preflight_profile);
  const detection = useMemo(() => {
    // The timestamp is intentionally a cache key: source is read imperatively
    // at this successful compile checkpoint, not subscribed to per keystroke.
    void lastCompiledAt;
    const source = useFilesStore.getState().files[mainDoc]?.content ?? "";
    const resume = looksLikeResumeSource(source);
    const suggested: Flags = {
      ats: resume,
      compile: true,
      a11y: !resume,
      refs: !resume,
      submission: !resume,
      privacy: !resume,
    };
    const suggestedOpen: Flags = {
      ats: resume,
      compile: !resume,
      a11y: false,
      refs: false,
      submission: false,
      privacy: false,
    };
    return { suggested, suggestedOpen, profile: detectSubmissionProfile(source) };
  }, [mainDoc, lastCompiledAt]);
  const enabled = storedEnabled ?? detection.suggested;
  const expanded = storedOpen ?? detection.suggestedOpen;
  const submissionProfile = storedSubmissionProfile ?? detection.profile;
  // Which run is in flight, so only the clicked button shows a spinner.
  const [busy, setBusy] = useState<CheckId | "all" | null>(null);

  const flip = (id: CheckId) => setEnabled({ ...enabled, [id]: !enabled[id] });
  const toggleOpen = (id: CheckId) => setOpen({ ...expanded, [id]: !expanded[id] });

  const runOne = async (id: CheckId) => {
    setBusy(id);
    setRan({ ...ran, [id]: true });
    setOpen({ ...expanded, [id]: true });
    await run();
    setBusy(null);
  };
  const runEnabled = async () => {
    setBusy("all");
    setRan(Object.fromEntries(CHECK_IDS.map((id) => [id, enabled[id]])) as Flags);
    setOpen(Object.fromEntries(CHECK_IDS.map((id) => [id, enabled[id] || expanded[id]])) as Flags);
    await run();
    setBusy(null);
  };
  const spinning = (id: CheckId) => busy === id || busy === "all";

  const enabledCount = CHECK_IDS.filter((id) => enabled[id]).length;

  return (
    <div
      className="flex h-full flex-col"
      data-testid="preflight-panel"
      data-running={running ? "true" : "false"}
      data-report={report ? "true" : "false"}
      data-error={error ?? ""}
    >
      <div className="relative flex h-9 items-center gap-2 border-b border-sidebar-border px-3">
        <ShieldCheck className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-medium uppercase tracking-wide text-sidebar-foreground/70">Preflight</span>
        <div className="ml-auto flex min-w-0 items-center gap-1">
          <button
            type="button"
            data-testid="preflight-reader-button"
            onClick={toggleReader}
            disabled={pageText.length === 0}
            title={pageText.length === 0 ? "Compile and run an output check first" : "Open the text extracted from the PDF"}
            className="flex min-w-0 items-center gap-1.5 rounded px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Eye className="size-3.5 shrink-0" />
            <span className="truncate">Show what the reader sees</span>
          </button>
          <Popover
            align="right"
            ariaLabel="About Preflight"
            trigger={<Info className="size-3.5" />}
            className="w-80 p-3"
          >
            <p className="text-xs font-semibold">What Preflight checks</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Preflight reads the project source, compiler log, and current PDF. Turn on only the checks that fit this
              document.
            </p>
            <dl className="mt-2 space-y-1.5 text-[11px] leading-relaxed">
              {CHECKS.map((check) => (
                <div key={check.id}>
                  <dt className="inline font-medium text-foreground">{check.label}: </dt>
                  <dd className="inline text-muted-foreground">{check.info}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 border-t border-border pt-2 text-[11px] leading-relaxed text-muted-foreground">
              Verified findings come from direct observations. Advisory findings still need your judgment. A clean
              report helps with review, but it does not certify acceptance or accessibility. All checks run locally.
            </p>
          </Popover>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 overflow-auto p-3">
        {CHECKS.map((c) => {
          const Icon = c.icon;
          const on = enabled[c.id];
          const isOpen = expanded[c.id];
          const showResults = on && ran[c.id] && !!report;
          return (
            <div key={c.id} className={cn("rounded-lg border border-sidebar-border bg-black/[0.03] dark:bg-background", !on && "opacity-70")}>
              <div className="flex items-center gap-2.5 p-3">
                <label htmlFor={`preflight-${c.id}`} className="shrink-0">
                  <Checkbox
                    id={`preflight-${c.id}`}
                    checked={on}
                    onCheckedChange={() => flip(c.id)}
                    aria-label={`Enable ${c.label}`}
                  />
                </label>
                <button type="button" onClick={() => toggleOpen(c.id)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm font-medium">{c.label}</span>
                </button>
                <button type="button"
                  onClick={() => void runOne(c.id)}
                  disabled={!on || running}
                  aria-label={ran[c.id] ? `Re-run ${c.label}` : `Run ${c.label}`}
                  className={cn(
                    "inline-flex min-w-14 shrink-0 items-center justify-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-40",
                    on
                      ? "bg-primary text-white hover:opacity-90"
                      : "border border-input hover:bg-accent",
                  )}
                >
                  {spinning(c.id) ? (
                    <RefreshCw className="size-3 animate-spin" />
                  ) : (
                    <>
                      <Play className="size-3" /> {ran[c.id] ? "Re-run" : "Run"}
                    </>
                  )}
                </button>
                <button type="button" onClick={() => toggleOpen(c.id)} aria-label={isOpen ? "Collapse" : "Expand"} className="shrink-0 text-muted-foreground">
                  <ChevronDown className={cn("size-4 transition-transform", isOpen && "rotate-180")} />
                </button>
              </div>

              {isOpen && (
                <div className="border-t border-sidebar-border px-3 py-2.5">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{c.who}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{c.detail}</p>
                  {c.id === "submission" && (
                    <div className="mt-3 rounded-md border border-sidebar-border bg-muted/25 p-2.5">
                      <label htmlFor="preflight-submission-profile" className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Publication profile
                      </label>
                      <Select
                        value={submissionProfile}
                        onValueChange={(value) => setSubmissionProfile(value as SubmissionProfileId)}
                      >
                        <SelectTrigger id="preflight-submission-profile" className="mt-1.5 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SUBMISSION_PROFILE_IDS.map((id) => (
                            <SelectItem key={id} value={id} className="text-xs">
                              {SUBMISSION_PROFILES[id].label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
                        {SUBMISSION_PROFILES[submissionProfile].description}
                      </p>
                    </div>
                  )}
                  {c.id === "privacy" && (
                    <label
                      htmlFor="preflight-anonymous-review"
                      className="mt-3 flex items-center justify-between gap-3 rounded-md border border-sidebar-border bg-muted/25 px-2.5 py-2"
                    >
                      <span>
                        <span className="block text-xs font-medium">Anonymous review</span>
                        <span className="mt-0.5 block text-[10px] leading-relaxed text-muted-foreground">
                          Also inspect author fields, acknowledgements, and PDF metadata.
                        </span>
                      </span>
                      <Switch
                        id="preflight-anonymous-review"
                        checked={anonymousReview}
                        onCheckedChange={setAnonymousReview}
                        aria-label="Check anonymous review identity"
                      />
                    </label>
                  )}
                  {sourcePreflight === "none" && c.id !== "refs" && (
                    <p className="mt-2 rounded bg-muted/60 px-2 py-1.5 text-[10px] text-muted-foreground">
                      {engineLabel} source checks are not implemented yet. This check uses the compiled PDF only and does not report missing source support as a failure.
                    </p>
                  )}
                  {showResults ? (
                    <CheckResults id={c.id} report={report} />
                  ) : (
                    on && <p className="mt-2 text-[11px] italic text-muted-foreground">Run this check to see results.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {enabledCount > 1 && (
          <button type="button"
            onClick={() => void runEnabled()}
            disabled={running}
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
          >
            {running ? <RefreshCw className="size-4 animate-spin" /> : <Play className="size-4" />}
            {running
              ? "Analyzing…"
              : `${CHECKS.every((c) => !enabled[c.id] || ran[c.id]) ? "Re-run" : "Run"} ${enabledCount} enabled checks`}
          </button>
        )}

        {error && <p className="px-1 text-xs text-red-500">Preflight failed: {error}</p>}

      </div>
      <ReaderViewDialog open={showReader} pages={pageText} onClose={toggleReader} />
    </div>
  );
}

const CheckResults = memo(function CheckResults({ id, report }: { id: CheckId; report: PreflightReport }) {
  const coverage = report.coverage[id];
  const { findings, src, out } = useMemo(() => {
    const shown = Object.fromEntries(CHECK_IDS.map((check) => [check, check === id])) as Flags;
    const f = report.findings.filter((x) => includes(x, shown));
    return {
      findings: f,
      src: bySeverity(f.filter((x) => !isOutputFinding(x))),
      out: bySeverity(f.filter(isOutputFinding)),
    };
  }, [id, report]);

  const group = (label: string, items: Finding[]) =>
    items.length > 0 && (
      <div className="mt-2 flex flex-col gap-1.5">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {items.map((f, i) => (
          <FindingRow key={`${f.id}:${f.file ?? ""}:${f.from ?? f.page ?? i}`} finding={f} />
        ))}
      </div>
    );

  return (
    <div className="mt-3">
      <div className="flex justify-center py-1">
        <ScoreRing
          label={SCORE_LABEL[id]}
          score={coverage === "not_run" || coverage === "unsupported" ? null : report.scores[id]}
        />
      </div>

      {id === "ats" && report.atsParse?.isResume && <AtsCard parse={report.atsParse} />}

      {(id === "ats" || id === "a11y") && !report.hasPdf && (
        <p className="mt-2 rounded-md border border-sidebar-border bg-black/[0.03] px-2.5 py-2 text-[11px] text-muted-foreground dark:bg-background">
          PDF required. Compile the project and run again. This check is not evaluated yet.
        </p>
      )}
      {id === "compile" && coverage === "not_run" && (
        <p className="mt-2 rounded-md border border-sidebar-border bg-black/[0.03] px-2.5 py-2 text-[11px] text-muted-foreground dark:bg-background">
          Compile the project first. Preflight needs the current compiler log or PDF to evaluate build quality.
        </p>
      )}
      {coverage === "partial" && (
        <p className="mt-2 rounded-md border border-sidebar-border bg-black/[0.03] px-2.5 py-2 text-[11px] text-muted-foreground dark:bg-background">
          Source checks completed. Compile the project and run again to finish the PDF-level checks.
        </p>
      )}
      {coverage === "unsupported" && (
        <p className="mt-2 rounded-md border border-sidebar-border px-2.5 py-2 text-[11px] text-muted-foreground">
          Not evaluated. Source checks for this engine are not implemented.
        </p>
      )}

      {group("Project & source", src)}
      {group("Compiled output", out)}

      {findings.length === 0 && coverage === "evaluated" && (
        <p className="mt-2 rounded-md border border-sidebar-border bg-black/[0.03] px-2.5 py-4 text-center text-xs text-muted-foreground dark:bg-background">
          No problems found.
        </p>
      )}

      {id === "a11y" && <PrepExport />}
    </div>
  );
});
