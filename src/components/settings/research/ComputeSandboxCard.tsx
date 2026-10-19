import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BetaBadge } from "@/components/ui/beta-badge";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { SectionHeading } from "@/components/ui/section-heading";
import { Spinner } from "@/components/ui/spinner";
import { SettingsNote } from "@/components/settings/SettingsNote";
import { SettingsPath } from "@/components/settings/SettingsPath";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsToggleRow } from "@/components/settings/SettingsToggleRow";
import { describeError } from "@/lib/app-error";
import {
  checkSandbox,
  removeSandboxAccess,
  sandboxStatus,
  setWindowsSandbox,
  type SandboxCheckReport,
  type SandboxStatus,
} from "./compute-api";

/** Checks that may fail without the sandbox being broken. */
const EXPECTED_FAILURES = new Set(["python_multiprocessing"]);

/** The first problem a self-test found, or `null` when it passed. */
export function checkProblem(report: SandboxCheckReport): string | null {
  if (!report.available) return report.reason ?? report.platform;
  const failed = report.checks.find((check) => !check.ok && !EXPECTED_FAILURES.has(check.id));
  return failed ? `${failed.id}: ${failed.detail || failed.expected}` : null;
}

/** The local sandbox: status, the Windows beta switch, interpreters and shared access. */
export function ComputeSandboxCard() {
  const { t } = useTranslation(["researchTools"]);
  const [status, setStatus] = useState<SandboxStatus | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<SandboxCheckReport | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    void sandboxStatus(false)
      .then((next) => {
        if (live.current) setStatus(next);
      })
      .catch((error: unknown) => {
        if (live.current) setFailure(describeError(error));
      });
    return () => {
      live.current = false;
    };
  }, []);

  const apply = async (work: () => Promise<SandboxStatus>) => {
    setFailure(null);
    try {
      const next = await work();
      if (live.current) setStatus(next);
    } catch (error) {
      if (live.current) setFailure(describeError(error));
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    await apply(() => sandboxStatus(true));
    if (live.current) setRefreshing(false);
  };

  const runCheck = async () => {
    setChecking(true);
    setCheck(null);
    setFailure(null);
    try {
      const report = await checkSandbox();
      if (live.current) setCheck(report);
    } catch (error) {
      if (live.current) setFailure(describeError(error));
    } finally {
      if (live.current) setChecking(false);
    }
  };

  const removeAccess = async () => {
    setConfirmRemove(false);
    setRemoving(true);
    await apply(removeSandboxAccess);
    if (live.current) setRemoving(false);
  };

  if (!status) {
    return failure ? (
      <p role="alert" className="select-text text-xs text-destructive">
        {failure}
      </p>
    ) : (
      <div className="flex justify-center py-2">
        <Spinner aria-hidden />
      </div>
    );
  }

  const windows = status.platform === "windows";
  let description: string;
  if (status.platform === "macos") description = t(($) => $.researchTools.compute.sandbox.macos);
  else if (status.platform === "linux")
    description = status.available
      ? t(($) => $.researchTools.compute.sandbox.linux)
      : t(($) => $.researchTools.compute.sandbox.linuxMissing);
  else description = status.reason ?? "";
  const problem = check ? checkProblem(check) : null;

  return (
    <div className="space-y-3" data-testid="compute-sandbox">
      {windows ? (
        <SettingsToggleRow
          testId="compute-sandbox-windows"
          label={t(($) => $.researchTools.compute.sandbox.windowsLabel)}
          description={t(($) => $.researchTools.compute.sandbox.windowsDescription)}
          adornment={<BetaBadge />}
          checked={status.windowsEnabled === true}
          disabled={!status.available}
          onChange={(enabled) => void apply(() => setWindowsSandbox(enabled))}
        />
      ) : (
        <SettingsRow
          testId="compute-sandbox-status"
          label={t(($) => $.researchTools.compute.targets.local)}
          description={description}
          adornment={
            <Badge size="sm" variant={status.available ? "success" : "destructive"}>
              {status.available
                ? t(($) => $.researchTools.compute.sandbox.ready)
                : t(($) => $.researchTools.compute.sandbox.unavailable)}
            </Badge>
          }
        />
      )}
      {windows && !status.available && status.reason ? (
        <p role="alert" className="select-text text-xs text-destructive">
          {status.reason}
        </p>
      ) : null}
      {windows ? (
        <>
          <SettingsNote>{t(($) => $.researchTools.compute.sandbox.limitsWindows)}</SettingsNote>
          <SettingsNote>{t(($) => $.researchTools.compute.sandbox.gpuWindows)}</SettingsNote>
        </>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="xs"
          variant="outline"
          disabled={checking || !status.available}
          onClick={() => void runCheck()}
          data-testid="compute-sandbox-check"
        >
          {checking ? <Spinner size="xs" aria-hidden /> : null}
          {checking
            ? t(($) => $.researchTools.compute.sandbox.checking)
            : t(($) => $.researchTools.compute.sandbox.check)}
        </Button>
        {check ? (
          <output className={problem ? "select-text text-xs text-destructive" : "text-xs text-muted-foreground"}>
            {problem
              ? t(($) => $.researchTools.compute.sandbox.checkFailed, { reason: problem })
              : t(($) => $.researchTools.compute.sandbox.checkPassed)}
          </output>
        ) : null}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <SectionHeading as="h4">{t(($) => $.researchTools.compute.sandbox.runtimes)}</SectionHeading>
          <Button size="xs" variant="ghost" disabled={refreshing} onClick={() => void refresh()}>
            {refreshing ? <Spinner size="xs" aria-hidden /> : <RefreshCw aria-hidden />}
            {t(($) => $.researchTools.compute.sandbox.refresh)}
          </Button>
        </div>
        {status.runtimes.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t(($) => $.researchTools.compute.sandbox.runtimesEmpty)}</p>
        ) : (
          <ul className="space-y-1" data-testid="compute-sandbox-runtimes">
            {status.runtimes.map((runtime) => (
              <li key={`${runtime.kind}:${runtime.executable}`} className="flex flex-wrap items-center gap-2 text-xs">
                <Badge size="sm" variant="muted">
                  {runtime.kind}
                </Badge>
                <SettingsPath path={runtime.executable} className="min-w-0 break-all font-mono" />
                {runtime.note ? <span className="text-muted-foreground">{runtime.note}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {windows ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <SectionHeading as="h4">{t(($) => $.researchTools.compute.sandbox.access)}</SectionHeading>
            <Button
              size="xs"
              variant="outline"
              disabled={removing || status.grants.length === 0}
              onClick={() => setConfirmRemove(true)}
              data-testid="compute-sandbox-remove-access"
            >
              {removing ? <Spinner size="xs" aria-hidden /> : null}
              {t(($) => $.researchTools.compute.sandbox.removeAccess)}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t(($) => $.researchTools.compute.sandbox.accessNote)}</p>
          {status.grants.length > 0 ? (
            <ul className="space-y-1">
              {status.grants.map((grant) => (
                <li key={`${grant.scope}:${grant.path}`} className="text-xs">
                  <SettingsPath path={grant.path} className="break-all font-mono" />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {failure ? (
        <p role="alert" className="select-text text-xs text-destructive">
          {failure}
        </p>
      ) : null}

      <ConfirmationDialog
        open={confirmRemove}
        destructive
        title={t(($) => $.researchTools.compute.sandbox.removeAccessTitle)}
        description={t(($) => $.researchTools.compute.sandbox.removeAccessConfirm)}
        confirmLabel={t(($) => $.researchTools.compute.sandbox.removeAccess)}
        onConfirm={() => void removeAccess()}
        onCancel={() => setConfirmRemove(false)}
      />
    </div>
  );
}
