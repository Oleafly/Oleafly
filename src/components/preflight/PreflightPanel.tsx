import { memo, useMemo, useState } from "react";
import { Accessibility, ChevronDown, Eye, FileSearch, Info, Link2, Play, RefreshCw, ShieldCheck } from "lucide-react";
import { usePreflightStore } from "@/store/preflight";
import { useFilesStore } from "@/store/files";
import { looksLikeResumeSource } from "@openleaf/preflight";
import type { Finding, PreflightReport, Severity } from "@openleaf/preflight";
import { ScoreRing } from "./ScoreRing";
import { FindingRow } from "./FindingRow";
import { ReaderView } from "./ReaderView";
import { AtsCard } from "./AtsCard";
import { PrepExport } from "./PrepExport";
import { cn } from "@/lib/utils";
import { Popover } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";

type CheckId = "ats" | "a11y" | "refs";
type Flags = Record<CheckId, boolean>;

const SEV_ORDER: Severity[] = ["error", "warning", "info"];

const CHECKS: { id: CheckId; label: string; icon: typeof FileSearch; who: string; detail: string }[] = [
  {
    id: "ats",
    label: "ATS readiness",
    icon: FileSearch,
    who: "For resumes and CVs",
    detail:
      "Simulates what an Applicant Tracking System (Workday, Taleo, Greenhouse) extracts from your PDF, and flags layout and formatting that scrambles it. Not relevant for research papers.",
  },
  {
    id: "a11y",
    label: "Accessibility",
    icon: Accessibility,
    who: "For research, government, and published PDFs",
    detail:
      "Checks screen-reader readiness against Section 508 / WCAG: missing alt text, document language, reading order, and whether the PDF is tagged. Optional for resumes.",
  },
  {
    id: "refs",
    label: "References & assets",
    icon: Link2,
    who: "For research and multi-file documents",
    detail:
      "Finds undefined citations and cross-references, duplicate labels, and missing figure or included files, before they break your PDF at submission.",
  },
];

const SCORE_LABEL: Record<CheckId, string> = { ats: "ATS", a11y: "Access", refs: "Refs" };
const forLens = (id: CheckId): Flags => ({ ats: id === "ats", a11y: id === "a11y", refs: id === "refs" });
function includes(f: Finding, shown: Flags): boolean {
  const inAts = f.lens === "ats" || f.lens === "both";
  const inA11y = f.lens === "a11y" || f.lens === "both";
  return (shown.ats && inAts) || (shown.a11y && inA11y) || (shown.refs && f.lens === "refs");
}
const isOutputFinding = (f: Finding) => f.id.startsWith("pdf-") || f.id.startsWith("output-") || f.id.startsWith("ats-");
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

  // Keyed on the active PATH (not its content), reading a content snapshot
  // imperatively, so typing doesn't re-render this panel or re-run the two
  // whole-document regex scans in `looksLikeResumeSource` on every keystroke.
  const activePath = useFilesStore((s) => s.activePath);
  const engineLabel = useFilesStore((s) => s.engine.label);
  const sourcePreflight = useFilesStore((s) => s.engine.capabilities.source_preflight_profile);
  const suggested = useMemo<Flags>(() => {
    const src = activePath ? useFilesStore.getState().files[activePath]?.content ?? "" : "";
    const resume = looksLikeResumeSource(src);
    // Resume: ATS. Otherwise: accessibility and integrity, the paper concerns.
    return { ats: resume, a11y: !resume, refs: !resume };
  }, [activePath]);
  const enabled = storedEnabled ?? suggested;
  const expanded = storedOpen ?? suggested;
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
    setRan({ ats: enabled.ats, a11y: enabled.a11y, refs: enabled.refs });
    setOpen({
      ats: enabled.ats || expanded.ats,
      a11y: enabled.a11y || expanded.a11y,
      refs: enabled.refs || expanded.refs,
    });
    await run();
    setBusy(null);
  };
  const spinning = (id: CheckId) => busy === id || busy === "all";

  const enabledCount = Number(enabled.ats) + Number(enabled.a11y) + Number(enabled.refs);

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
        <div className="ml-auto">
          <Popover
            align="right"
            ariaLabel="About Preflight"
            trigger={<Info className="size-3.5" />}
            className="w-72 p-3"
          >
              <p className="text-xs font-semibold">What is Preflight?</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                It checks how ready your document is before you send it out. Turn on the checks that fit your document
                and run them.
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">ATS readiness</span> is for resumes and CVs: whether an
                Applicant Tracking System can parse your contact details and sections.
              </p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">Accessibility</span> is for research, government, and any
                published PDF: screen-reader readiness and Section 508 / WCAG.
              </p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">References & assets</span> catches undefined citations and
                cross-references, duplicate labels, and missing files before they break your PDF.
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                Everything runs on your machine, from your source and last compiled PDF. Results are a readiness aid, not
                a formal certification.
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
                  aria-label={`Run ${c.label}`}
                  className={cn(
                    "inline-flex w-14 items-center justify-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-40",
                    on
                      ? "bg-primary text-white hover:opacity-90"
                      : "border border-input hover:bg-accent",
                  )}
                >
                  {spinning(c.id) ? (
                    <RefreshCw className="size-3 animate-spin" />
                  ) : (
                    <>
                      <Play className="size-3" /> Run
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
            {running ? "Analyzing…" : `Run ${enabledCount} enabled checks`}
          </button>
        )}

        {error && <p className="px-1 text-xs text-red-500">Preflight failed: {error}</p>}

        {(ran.ats || ran.a11y) && pageText.length > 0 && (
          <div className="mt-1">
            <button type="button"
              onClick={toggleReader}
              className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <Eye className="size-3.5" /> {showReader ? "Hide" : "Show"} what the reader sees
            </button>
            {showReader && <ReaderView pages={pageText} />}
          </div>
        )}
      </div>
    </div>
  );
}

const CheckResults = memo(function CheckResults({ id, report }: { id: CheckId; report: PreflightReport }) {
  const coverage = report.coverage[id];
  const { findings, src, out } = useMemo(() => {
    const shown = forLens(id);
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
          <FindingRow key={`${f.id}:${f.from ?? f.page ?? i}`} finding={f} />
        ))}
      </div>
    );

  return (
    <div className="mt-3">
      <div className="flex justify-center py-1">
        <ScoreRing label={SCORE_LABEL[id]} score={id === "ats" ? report.atsScore : id === "a11y" ? report.a11yScore : report.refsScore} />
      </div>

      {id === "ats" && report.atsParse?.isResume && <AtsCard parse={report.atsParse} />}

      {id !== "refs" && !report.hasPdf && (
        <p className="mt-2 rounded-md border border-sidebar-border bg-black/[0.03] px-2.5 py-2 text-[11px] text-muted-foreground dark:bg-background">
          PDF required. Compile the project and run again. This check is not evaluated yet.
        </p>
      )}
      {coverage === "unsupported" && (
        <p className="mt-2 rounded-md border border-sidebar-border px-2.5 py-2 text-[11px] text-muted-foreground">
          Not evaluated. Source checks for this engine are not implemented.
        </p>
      )}

      {group("Source", src)}
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
