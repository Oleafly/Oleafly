import type { Finding } from "@oleafly/preflight";
import { i18n } from "@/i18n";
import { notifyError, toast } from "@/lib/toast";
import { usePreflightStore } from "@/store/preflight";
import type { WritingSettings } from "@oleafly/preflight/writing/settings";
import { applyWritingFixes, ignoreWritingFinding, updateWritingSettings } from "./writing-fixes";

export async function fixWritingFindings(findings: readonly Finding[]): Promise<void> {
  try {
    const outcome = await applyWritingFixes(findings);
    if (outcome.failedFiles.length > 0) toast.error(i18n.t(($) => $.preflight.panel.writing.fixFailed));
    if (outcome.applied > 1) toast.success(i18n.t(($) => $.preflight.panel.writing.fixed, { count: outcome.applied }));
    if (outcome.skipped > 0) toast.info(i18n.t(($) => $.preflight.panel.writing.skipped, { count: outcome.skipped }));
  } catch (error) {
    notifyError("apply writing fixes", error, i18n.t(($) => $.preflight.panel.writing.fixFailed));
  }
  await usePreflightStore.getState().run();
}

export async function ignoreWritingFindingAndRerun(finding: Finding): Promise<void> {
  try {
    await ignoreWritingFinding(finding);
  } catch (error) {
    notifyError("ignore writing finding", error, i18n.t(($) => $.preflight.panel.writing.saveFailed));
    return;
  }
  await usePreflightStore.getState().run();
}

export async function saveWritingSettings(change: (current: WritingSettings) => WritingSettings): Promise<boolean> {
  try {
    await updateWritingSettings(change);
  } catch (error) {
    notifyError("save writing settings", error, i18n.t(($) => $.preflight.panel.writing.saveFailed));
    return false;
  }
  const preflight = usePreflightStore.getState();
  if (preflight.report && !preflight.running) void preflight.run();
  return true;
}
