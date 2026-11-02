import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type LucideIcon, MoreHorizontal, Plus } from "lucide-react";
import { Box, Cpu, Laptop, Server, ShieldCheck } from "@/components/icons/pack";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ErrorState } from "@/components/ui/empty";
import { SectionHeading } from "@/components/ui/section-heading";
import { Spinner } from "@/components/ui/spinner";
import { SettingsNote } from "@/components/settings/SettingsNote";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { describeError } from "@/lib/app-error";
import { formatList, formatRelativeTimeFrom } from "@/lib/intl";
import { ComputeSandboxCard } from "./ComputeSandboxCard";
import { ResearchCard } from "./ResearchCard";
import {
  announceTargetsChanged,
  computeSettings,
  emptyTarget,
  forgetHostKey,
  removeComputeTarget,
  saveComputeTarget,
  targetSummary,
  testComputeTarget,
  trustHostKey,
  type CheckStatus,
  type ComputeKind,
  type ComputeTarget,
  type ComputeTestReport,
  type ComputeView,
  type HostKeyPrompt,
  type TestSummary,
} from "./compute-api";

const ComputeTargetDialog = lazy(() =>
  import("./ComputeTargetDialog").then((module) => ({ default: module.ComputeTargetDialog })),
);
const ComputeHostKeyDialog = lazy(() =>
  import("./ComputeHostKeyDialog").then((module) => ({ default: module.ComputeHostKeyDialog })),
);
const ComputeSshImportDialog = lazy(() =>
  import("./ComputeSshImportDialog").then((module) => ({ default: module.ComputeSshImportDialog })),
);

interface HostKeyEntry {
  target: ComputeTarget;
  prompt: HostKeyPrompt;
}

export const STATUS_VARIANT: Record<CheckStatus, BadgeVariant> = {
  pass: "success",
  warn: "warning",
  fail: "destructive",
  skipped: "muted",
};

const KIND_ICON: Record<ComputeKind, LucideIcon> = {
  ssh: Server,
  slurm: Cpu,
  cuaSpace: Box,
};

function KindIcon({ kind }: Readonly<{ kind: ComputeKind }>) {
  const Icon = KIND_ICON[kind];
  return <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />;
}

function TestReportList({ report }: Readonly<{ report: ComputeTestReport }>) {
  const { t } = useTranslation(["researchTools"]);
  return (
    <ul className="mt-2 space-y-1" data-testid={`compute-report-${report.targetId}`}>
      {report.checks.map((check) => (
        <li key={check.id} className="flex flex-wrap items-center gap-2 text-xs">
          <Badge size="sm" variant={STATUS_VARIANT[check.status]}>
            {t(($) => $.researchTools.compute.test[check.status])}
          </Badge>
          <span className="font-medium">{t(($) => $.researchTools.compute.test[check.id])}</span>
          {check.detail ? <span className="min-w-0 break-words text-muted-foreground">{check.detail}</span> : null}
        </li>
      ))}
      {report.error ? (
        <li role="alert" className="select-text text-xs text-destructive">
          {report.error}
        </li>
      ) : null}
    </ul>
  );
}

function TargetRow({
  target,
  summary,
  report,
  testing,
  onTest,
  onEdit,
  onForget,
  onRemove,
  onReviewHostKey,
}: Readonly<{
  target: ComputeTarget;
  summary?: TestSummary;
  report?: ComputeTestReport;
  testing: boolean;
  onTest: () => void;
  onEdit: () => void;
  onForget: () => void;
  onRemove: () => void;
  onReviewHostKey: () => void;
}>) {
  const { t } = useTranslation(["researchTools"]);
  let status = null;
  if (!testing) {
    if (!summary) {
      status = (
        <Badge size="sm" variant="muted">
          {t(($) => $.researchTools.compute.targets.notTested)}
        </Badge>
      );
    } else if (summary.ok) {
      status = (
        <Badge size="sm" variant="success">
          {t(($) => $.researchTools.compute.targets.tested, { time: formatRelativeTimeFrom(summary.at) })}
        </Badge>
      );
    } else {
      status = (
        <Badge size="sm" variant="destructive">
          {t(($) => $.researchTools.compute.targets.testFailed)}
        </Badge>
      );
    }
  }
  return (
    <SettingsRow
      testId={`compute-target-${target.id}`}
      icon={<KindIcon kind={target.kind} />}
      label={target.label}
      description={targetSummary(target, summary?.resolved)}
      adornment={
        <>
          <Badge size="sm" variant="muted">
            {t(($) => $.researchTools.compute.kind[target.kind])}
          </Badge>
          {status}
        </>
      }
      details={report ? <TestReportList report={report} /> : null}
      control={
        <div className="flex shrink-0 items-center gap-1">
          {report?.hostKey && !testing ? (
            <Button size="xs" variant="outline" onClick={onReviewHostKey} data-testid={`compute-host-key-${target.id}`}>
              {t(($) => $.researchTools.compute.targets.reviewHostKey)}
            </Button>
          ) : null}
          <Button size="xs" variant="outline" disabled={testing} onClick={onTest}>
            {testing ? <Spinner size="xs" aria-hidden /> : null}
            {testing
              ? t(($) => $.researchTools.compute.targets.testing)
              : t(($) => $.researchTools.compute.targets.test)}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="xs"
                variant="ghost"
                aria-label={t(($) => $.researchTools.compute.targets.more, { label: target.label })}
              >
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-[100]">
              <DropdownMenuItem onSelect={onEdit}>{t(($) => $.researchTools.compute.targets.edit)}</DropdownMenuItem>
              {target.kind === "cuaSpace" ? null : (
                <DropdownMenuItem onSelect={onForget}>
                  {t(($) => $.researchTools.compute.targets.forgetHostKey)}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={onRemove} className="text-destructive focus:text-destructive">
                {t(($) => $.researchTools.compute.targets.remove)}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      }
    />
  );
}

export function ComputeSection() {
  const { t } = useTranslation(["common", "researchTools"]);
  const [view, setView] = useState<ComputeView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<string, ComputeTestReport>>({});
  const [testing, setTesting] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<ComputeTarget | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [removing, setRemoving] = useState<ComputeTarget | null>(null);
  const [hostKeys, setHostKeys] = useState<readonly HostKeyEntry[]>([]);
  const mounted = useRef(true);

  const load = useCallback(() => {
    setLoadError(null);
    void computeSettings()
      .then((next) => {
        if (mounted.current) setView(next);
      })
      .catch((error: unknown) => {
        if (mounted.current) setLoadError(describeError(error));
      });
  }, []);

  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const refresh = useCallback(async () => {
    try {
      const next = await computeSettings();
      if (mounted.current) setView(next);
    } catch {
      // The list stays as it was.
    }
  }, []);

  const queueHostKey = useCallback((entry: HostKeyEntry) => {
    setHostKeys((current) => {
      const index = current.findIndex((item) => item.target.id === entry.target.id);
      if (index === -1) return [...current, entry];
      if (index === 0) return current;
      return current.map((item, at) => (at === index ? entry : item));
    });
  }, []);

  const testRuns = useRef(new Map<string, number>());

  const runTest = useCallback(
    async (target: ComputeTarget) => {
      const run = (testRuns.current.get(target.id) ?? 0) + 1;
      testRuns.current.set(target.id, run);
      const current = () => mounted.current && testRuns.current.get(target.id) === run;
      setTesting((testing) => new Set(testing).add(target.id));
      try {
        const report = await testComputeTarget(target.id);
        if (!current()) return;
        setReports((reports) => ({ ...reports, [target.id]: report }));
        if (report.hostKey) queueHostKey({ target, prompt: report.hostKey });
        await refresh();
      } catch (error) {
        if (!current()) return;
        setReports((reports) => ({
          ...reports,
          [target.id]: { targetId: target.id, checks: [], finishedAt: Date.now(), error: describeError(error) },
        }));
      } finally {
        if (current()) {
          setTesting((testing) => {
            const next = new Set(testing);
            next.delete(target.id);
            return next;
          });
        }
      }
    },
    [refresh, queueHostKey],
  );

  const dropReport = (id: string) =>
    setReports((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });

  const save = async (target: ComputeTarget) => {
    const before = new Set(view?.targets.map((item) => item.id) ?? []);
    const next = await saveComputeTarget(target);
    if (!mounted.current) return;
    setView(next);
    dropReport(target.id);
    announceTargetsChanged();
    const saved = target.id
      ? next.targets.find((item) => item.id === target.id)
      : next.targets.find((item) => !before.has(item.id));
    if (saved) void runTest(saved);
  };

  const importTargets = async (targets: ComputeTarget[]) => {
    const before = new Set(view?.targets.map((item) => item.id) ?? []);
    let next: ComputeView | null = null;
    const skipped: { label: string; error: unknown }[] = [];
    for (const target of targets) {
      try {
        next = await saveComputeTarget(target);
      } catch (error) {
        skipped.push({ label: target.label, error });
      }
    }
    if (next && mounted.current) {
      setView(next);
      announceTargetsChanged();
      const added = next.targets.filter((item) => !before.has(item.id));
      void (async () => {
        for (const target of added) {
          if (!mounted.current) return;
          await runTest(target);
        }
      })();
    }
    if (skipped.length > 0) {
      throw new Error(
        t(($) => $.researchTools.compute.import.skipped, {
          hosts: formatList(skipped.map((item) => item.label)),
          reason: describeError(skipped[0].error),
        }),
      );
    }
  };

  const remove = async (target: ComputeTarget) => {
    setRemoving(null);
    setActionError(null);
    try {
      const next = await removeComputeTarget(target.id);
      if (!mounted.current) return;
      setView(next);
      dropReport(target.id);
      announceTargetsChanged();
    } catch (error) {
      if (mounted.current) setActionError(describeError(error));
    }
  };

  const forget = async (target: ComputeTarget) => {
    setActionError(null);
    try {
      const next = await forgetHostKey(target.id);
      if (!mounted.current) return;
      setView(next);
      dropReport(target.id);
    } catch (error) {
      if (mounted.current) setActionError(describeError(error));
    }
  };

  const trust = async (target: ComputeTarget, fingerprints: string[]) => {
    const report = await trustHostKey(target.id, fingerprints);
    if (!mounted.current) return;
    setReports((current) => ({ ...current, [target.id]: report }));
    setHostKeys((current) => {
      const rest = current.filter((item) => item.target.id !== target.id);
      return report.hostKey ? [{ target, prompt: report.hostKey }, ...rest] : rest;
    });
    await refresh();
  };

  const closeHostKey = (target: ComputeTarget) =>
    setHostKeys((current) => current.filter((item) => item.target.id !== target.id));

  const reviewHostKey = (target: ComputeTarget, prompt: HostKeyPrompt) =>
    setHostKeys((current) => [{ target, prompt }, ...current.filter((item) => item.target.id !== target.id)]);

  const platform = view?.platform;
  const hasCua = view?.targets.some((target) => target.kind === "cuaSpace") ?? false;
  const shownHostKey = hostKeys[0] ?? null;

  return (
    <>
      <ResearchCard
        id="research-compute-title"
        icon={Server}
        title={t(($) => $.researchTools.compute.title)}
        description={t(($) => $.researchTools.compute.description)}
        testId="research-compute"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionHeading as="h4">{t(($) => $.researchTools.compute.targets.heading)}</SectionHeading>
          <div className="flex items-center gap-2">
            {view?.sshAvailable ? (
              <Button size="xs" variant="outline" onClick={() => setImportOpen(true)} data-testid="compute-import">
                {t(($) => $.researchTools.compute.targets.import)}
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="xs" variant="outline" disabled={!view} data-testid="compute-add">
                  <Plus aria-hidden />
                  {t(($) => $.researchTools.compute.targets.add)}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="z-[100]">
                <DropdownMenuItem onSelect={() => setEditing(emptyTarget("ssh"))}>
                  <Server aria-hidden className="size-4" />
                  {t(($) => $.researchTools.compute.targets.addSsh)}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setEditing(emptyTarget("slurm"))}>
                  <Cpu aria-hidden className="size-4" />
                  {t(($) => $.researchTools.compute.targets.addSlurm)}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setEditing(emptyTarget("cuaSpace"))}>
                  <Box aria-hidden className="size-4" />
                  {t(($) => $.researchTools.compute.targets.addCua)}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {loadError ? (
          <ErrorState size="compact" message={loadError}>
            <Button size="xs" variant="outline" onClick={load}>
              {t(($) => $.common.actions.retry)}
            </Button>
          </ErrorState>
        ) : null}
        <SettingsRow
          testId="compute-target-local"
          icon={<Laptop aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
          label={t(($) => $.researchTools.compute.targets.local)}
          description={t(($) => $.researchTools.compute.targets.localDescription)}
        />
        {view?.targets.map((target) => (
          <TargetRow
            key={target.id}
            target={target}
            summary={view.tested[target.id]}
            report={reports[target.id]}
            testing={testing.has(target.id)}
            onTest={() => void runTest(target)}
            onEdit={() => setEditing(target)}
            onForget={() => void forget(target)}
            onRemove={() => setRemoving(target)}
            onReviewHostKey={() => {
              const prompt = reports[target.id]?.hostKey;
              if (prompt) reviewHostKey(target, prompt);
            }}
          />
        ))}
        {actionError ? (
          <p role="alert" className="select-text text-xs text-destructive">
            {actionError}
          </p>
        ) : null}
        <SettingsNote>{t(($) => $.researchTools.compute.notes.keys)}</SettingsNote>
        {view && view.targets.length > 0 ? (
          <SettingsNote>{t(($) => $.researchTools.compute.notes.outputs)}</SettingsNote>
        ) : null}
        {platform === "windows" ? (
          <SettingsNote testId="compute-note-windows-rsync">
            {t(($) => $.researchTools.compute.notes.windowsRsync)}
          </SettingsNote>
        ) : null}
        {view && !view.sshAvailable ? (
          <SettingsNote testId="compute-note-ssh-missing">
            {platform === "windows"
              ? t(($) => $.researchTools.compute.notes.sshMissingWindows)
              : t(($) => $.researchTools.compute.notes.sshMissing)}
          </SettingsNote>
        ) : null}
        {hasCua && view && !view.cuaAvailable ? (
          <SettingsNote testId="compute-note-cua-missing">
            {t(($) => $.researchTools.compute.notes.cuaMissing)}
          </SettingsNote>
        ) : null}
      </ResearchCard>

      <ResearchCard
        id="research-sandbox-title"
        icon={ShieldCheck}
        title={t(($) => $.researchTools.compute.sandbox.heading)}
        description={t(($) => $.researchTools.compute.sandbox.description)}
        testId="research-sandbox"
      >
        <ComputeSandboxCard />
      </ResearchCard>

      {editing ? (
        <Suspense fallback={null}>
          <ComputeTargetDialog target={editing} onClose={() => setEditing(null)} onSave={save} />
        </Suspense>
      ) : null}
      {importOpen ? (
        <Suspense fallback={null}>
          <ComputeSshImportDialog
            existing={view?.targets ?? []}
            onClose={() => setImportOpen(false)}
            onImport={importTargets}
          />
        </Suspense>
      ) : null}
      {shownHostKey ? (
        <Suspense fallback={null}>
          <ComputeHostKeyDialog
            key={shownHostKey.target.id}
            prompt={shownHostKey.prompt}
            onClose={() => closeHostKey(shownHostKey.target)}
            onTrust={(fingerprints) => trust(shownHostKey.target, fingerprints)}
          />
        </Suspense>
      ) : null}
      <ConfirmationDialog
        open={removing !== null}
        destructive
        title={t(($) => $.researchTools.compute.targets.removeTitle, { label: removing?.label ?? "" })}
        description={t(($) => $.researchTools.compute.targets.removeConfirm)}
        confirmLabel={t(($) => $.researchTools.compute.targets.remove)}
        onConfirm={() => {
          if (removing) void remove(removing);
        }}
        onCancel={() => setRemoving(null)}
      />
    </>
  );
}
