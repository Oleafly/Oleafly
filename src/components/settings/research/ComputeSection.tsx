import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Box, Cpu, Laptop, MoreHorizontal, Plus, Server, ShieldCheck } from "lucide-react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SectionHeading } from "@/components/ui/section-heading";
import { Spinner } from "@/components/ui/spinner";
import { SettingsNote } from "@/components/settings/SettingsNote";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { describeError } from "@/lib/app-error";
import { formatRelativeTimeFrom } from "@/lib/intl";
import { ComputeSandboxCard } from "./ComputeSandboxCard";
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

export const STATUS_VARIANT: Record<CheckStatus, BadgeVariant> = {
  pass: "success",
  warn: "warning",
  fail: "destructive",
  skipped: "muted",
};

function KindIcon({ kind }: Readonly<{ kind: ComputeKind }>) {
  const Icon = kind === "ssh" ? Server : kind === "slurm" ? Cpu : Box;
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
}: Readonly<{
  target: ComputeTarget;
  summary?: TestSummary;
  report?: ComputeTestReport;
  testing: boolean;
  onTest: () => void;
  onEdit: () => void;
  onForget: () => void;
  onRemove: () => void;
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

/** Settings › Research › Compute: run targets and the sandbox on this computer. */
export function ComputeSection() {
  const { t } = useTranslation(["researchTools"]);
  const [view, setView] = useState<ComputeView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reports, setReports] = useState<Record<string, ComputeTestReport>>({});
  const [testing, setTesting] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<ComputeTarget | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [removing, setRemoving] = useState<ComputeTarget | null>(null);
  const [hostKey, setHostKey] = useState<{ target: ComputeTarget; prompt: HostKeyPrompt } | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void computeSettings()
      .then((next) => {
        if (mounted.current) setView(next);
      })
      .catch((error: unknown) => {
        if (mounted.current) setLoadError(describeError(error));
      });
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await computeSettings();
      if (mounted.current) setView(next);
    } catch {
      // The list stays as it was.
    }
  }, []);

  const runTest = useCallback(
    async (target: ComputeTarget) => {
      setTesting((current) => new Set(current).add(target.id));
      try {
        const report = await testComputeTarget(target.id);
        if (!mounted.current) return;
        setReports((current) => ({ ...current, [target.id]: report }));
        if (report.hostKey) setHostKey({ target, prompt: report.hostKey });
        await refresh();
      } catch (error) {
        if (!mounted.current) return;
        setReports((current) => ({
          ...current,
          [target.id]: { targetId: target.id, checks: [], finishedAt: Date.now(), error: describeError(error) },
        }));
      } finally {
        if (mounted.current) {
          setTesting((current) => {
            const next = new Set(current);
            next.delete(target.id);
            return next;
          });
        }
      }
    },
    [refresh],
  );

  const dropReport = (id: string) =>
    setReports((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });

  /** Saves a target and tests it at once (errors go back to the dialog). */
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
    for (const target of targets) next = await saveComputeTarget(target);
    if (!next || !mounted.current) return;
    setView(next);
    announceTargetsChanged();
    for (const added of next.targets.filter((item) => !before.has(item.id))) void runTest(added);
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

  /** Trusts the keys the user saw, then shows the new test (errors go back to the dialog). */
  const trust = async (fingerprints: string[]) => {
    if (!hostKey) return;
    const { target } = hostKey;
    const report = await trustHostKey(target.id, fingerprints);
    if (!mounted.current) return;
    setReports((current) => ({ ...current, [target.id]: report }));
    setHostKey(report.hostKey ? { target, prompt: report.hostKey } : null);
    await refresh();
  };

  const platform = view?.platform;
  const hasCua = view?.targets.some((target) => target.kind === "cuaSpace") ?? false;

  return (
    <>
      <section
        aria-labelledby="research-compute-title"
        className="overflow-hidden rounded-xl border bg-card/60"
        data-testid="research-compute"
      >
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Server aria-hidden className="size-4" />
          </span>
          <div className="min-w-0">
            <h3 id="research-compute-title" className="font-medium">
              {t(($) => $.researchTools.compute.title)}
            </h3>
            <p className="text-xs text-muted-foreground">{t(($) => $.researchTools.compute.description)}</p>
          </div>
        </div>
        <div className="space-y-3 px-4 py-4">
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
            <p role="alert" className="select-text text-xs text-destructive">
              {loadError}
            </p>
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
        </div>
      </section>

      <section
        aria-labelledby="research-sandbox-title"
        className="overflow-hidden rounded-xl border bg-card/60"
        data-testid="research-sandbox"
      >
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ShieldCheck aria-hidden className="size-4" />
          </span>
          <div className="min-w-0">
            <h3 id="research-sandbox-title" className="font-medium">
              {t(($) => $.researchTools.compute.sandbox.heading)}
            </h3>
            <p className="text-xs text-muted-foreground">{t(($) => $.researchTools.compute.sandbox.description)}</p>
          </div>
        </div>
        <div className="px-4 py-4">
          <ComputeSandboxCard />
        </div>
      </section>

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
      {hostKey ? (
        <Suspense fallback={null}>
          <ComputeHostKeyDialog prompt={hostKey.prompt} onClose={() => setHostKey(null)} onTrust={trust} />
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
