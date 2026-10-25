import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, type LucideIcon, MinusCircle } from "lucide-react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/ui/empty";
import { i18n } from "@/i18n";
import { describeError } from "@/lib/app-error";
import type { EvidenceCheckId, EvidenceItem, EvidenceReport, EvidenceStatus } from "@/lib/research-tasks";

function checkLabel(id: EvidenceCheckId): string {
  switch (id) {
    case "build":
      return i18n.t(($) => $.researchTools.evidence.checks.build);
    case "references":
      return i18n.t(($) => $.researchTools.evidence.checks.references);
    case "bibliography":
      return i18n.t(($) => $.researchTools.evidence.checks.bibliography);
    case "numbers":
      return i18n.t(($) => $.researchTools.evidence.checks.numbers);
    case "figures":
      return i18n.t(($) => $.researchTools.evidence.checks.figures);
  }
}

function statusLabel(status: EvidenceStatus): string {
  switch (status) {
    case "pass":
      return i18n.t(($) => $.researchTools.evidence.status.pass);
    case "warn":
      return i18n.t(($) => $.researchTools.evidence.status.warn);
    case "skipped":
      return i18n.t(($) => $.researchTools.evidence.status.skipped);
  }
}

/** The sentence for one finding; unknown codes show the code itself. */
export function evidenceItemText(item: EvidenceItem): string {
  const p = item.params;
  switch (item.code) {
    case "build.failed":
      return i18n.t(($) => $.researchTools.evidence.items.buildFailed, { errors: p.errors ?? "" });
    case "build.skipped":
      return i18n.t(($) => $.researchTools.evidence.items.buildSkipped, { reason: p.reason ?? "" });
    case "references.unresolved":
      return i18n.t(($) => $.researchTools.evidence.items.referencesUnresolved, { key: p.key ?? "" });
    case "references.notChecked":
      return i18n.t(($) => $.researchTools.evidence.items.referencesNotChecked);
    case "bib.unverified":
      return i18n.t(($) => $.researchTools.evidence.items.bibUnverified, { key: p.key ?? "" });
    case "bib.titleMismatch":
      return i18n.t(($) => $.researchTools.evidence.items.bibTitleMismatch, {
        key: p.key ?? "",
        found: p.found ?? "",
      });
    case "bib.lookupFailed":
      return i18n.t(($) => $.researchTools.evidence.items.bibLookupFailed, { key: p.key ?? "" });
    case "numbers.mismatch":
      return i18n.t(($) => $.researchTools.evidence.items.numbersMismatch, {
        value: p.value ?? "",
        run: p.run ?? "",
        recorded: p.recorded ?? "",
      });
    case "numbers.unknownRun":
      return i18n.t(($) => $.researchTools.evidence.items.numbersUnknownRun, { run: p.run ?? "" });
    case "numbers.noLedgerRow":
      return i18n.t(($) => $.researchTools.evidence.items.numbersNoLedgerRow, { run: p.run ?? "" });
    case "figures.missing":
      return i18n.t(($) => $.researchTools.evidence.items.figuresMissing, { path: p.path ?? "" });
    case "figures.unused":
      return i18n.t(($) => $.researchTools.evidence.items.figuresUnused, { path: p.path ?? "" });
    default:
      return item.code;
  }
}

const STATUS_VARIANT: Record<EvidenceStatus, BadgeVariant> = {
  pass: "success",
  warn: "warning",
  skipped: "muted",
};

const STATUS_ICON: Record<EvidenceStatus, LucideIcon> = {
  pass: CheckCircle2,
  warn: AlertTriangle,
  skipped: MinusCircle,
};

function StatusBadge({ status }: Readonly<{ status: EvidenceStatus }>) {
  const Icon = STATUS_ICON[status];
  return (
    <Badge variant={STATUS_VARIANT[status]} className="shrink-0 gap-1">
      <Icon aria-hidden className="size-3" />
      {statusLabel(status)}
    </Badge>
  );
}

interface EvidenceChecklistProps {
  report: EvidenceReport | null;
  checking: boolean;
  onRefresh: () => Promise<void>;
}

/** Items one check lists before saying how many more it found. */
const SHOWN_ITEMS = 50;

/** Evidence checks on a task's result. They only warn; applying stays possible. */
export function EvidenceChecklist({ report, checking, onRefresh }: Readonly<EvidenceChecklistProps>) {
  const { t } = useTranslation(["researchTools"]);
  const [refreshing, setRefreshing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const busy = checking || refreshing;
  const refresh = async () => {
    setRefreshing(true);
    setFailure(null);
    try {
      await onRefresh();
    } catch (cause) {
      // The checks didn't run (the workspace is gone, the task moved on): say so.
      setFailure(describeError(cause));
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <section aria-labelledby="research-evidence" className="space-y-2" data-testid="research-evidence">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h5 id="research-evidence" className="text-sm font-medium">
            {t(($) => $.researchTools.evidence.title)}
          </h5>
          <p className="text-xs text-muted-foreground">{t(($) => $.researchTools.evidence.hint)}</p>
        </div>
        {/* A check the task started can be cut off by an exit and say "Checking" for good, so it never locks this out. */}
        <Button size="xs" variant="outline" disabled={refreshing} onClick={() => void refresh()}>
          {refreshing ? t(($) => $.researchTools.evidence.running) : t(($) => $.researchTools.evidence.refresh)}
        </Button>
      </div>
      {failure ? (
        <p role="alert" className="select-text text-xs text-destructive">
          {failure}
        </p>
      ) : null}
      {report ? (
        <ul className="divide-y rounded-md border">
          {report.checks.map((check) => (
            <li key={check.id} className="px-3 py-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1">{checkLabel(check.id)}</span>
                <StatusBadge status={check.status} />
              </div>
              {check.items.length > 0 ? (
                <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  {check.items.slice(0, SHOWN_ITEMS).map((item, index) => (
                    <li key={`${item.code}-${index}`} className="select-text break-words">
                      {evidenceItemText(item)}
                      {item.file ? (
                        <span className="ml-1 font-mono">
                          {item.file}
                          {item.line ? `:${item.line}` : ""}
                        </span>
                      ) : null}
                    </li>
                  ))}
                  {check.items.length > SHOWN_ITEMS ? (
                    <li data-testid="research-evidence-more">
                      {t(($) => $.researchTools.evidence.more, { count: check.items.length - SHOWN_ITEMS })}
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {busy ? (
        <LoadingState size="compact" label={t(($) => $.researchTools.evidence.running)} />
      ) : null}
      {!report && !busy && !failure ? (
        <EmptyState
          size="compact"
          className="rounded-md border border-dashed p-3"
          description={t(($) => $.researchTools.evidence.empty)}
        />
      ) : null}
    </section>
  );
}
