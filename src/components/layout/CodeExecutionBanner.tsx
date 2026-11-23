import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { WorkspaceBanner, WorkspaceBannerButton } from "@/components/ui/workspace-banner";
import { useCollabSettingsLocked } from "@/lib/collab-live-bridge";
import { applyShellEscape } from "@/lib/latex-compile-actions";
import { basename } from "@/lib/path-utils";
import { useCompileTarget } from "@/lib/tex-root";
import { isNotebookEngine } from "@/lib/notebook-engines";
import type { CompileError } from "@/lib/tauri";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { folderIsRestricted, useFolderAccessStore } from "@/store/folder-access";
import { notifyError } from "@/lib/toast";
import { chooseMainDocument } from "@/store/main-document";

type CodeExecutionNeed = "needed" | "skipped" | "storedResults";

const NEED_BY_CODE: ReadonlyMap<string, CodeExecutionNeed> = new Map([
  ["notebook.code_needed", "needed"],
  ["notebook.code_skipped", "skipped"],
  ["notebook.stored_results", "storedResults"],
]);

const NEED_ORDER: readonly CodeExecutionNeed[] = ["needed", "skipped", "storedResults"];
const R_MISSING = "notebook.r_missing";

export function codeExecutionNeed(errors: readonly CompileError[]): CodeExecutionNeed | null {
  if (errors.some((error) => error.code === R_MISSING)) return null;
  const needs = new Set<CodeExecutionNeed>();
  for (const error of errors) {
    const need = error.code ? NEED_BY_CODE.get(error.code) : undefined;
    if (need) needs.add(need);
  }
  return NEED_ORDER.find((need) => needs.has(need)) ?? null;
}

export function CodeExecutionBanner() {
  const { t } = useTranslation(["shell"]);
  const projectId = useFilesStore((state) => state.projectId);
  const blocked = useFilesStore(
    (state) => isNotebookEngine(state.engine) && !state.engine.allow_shell_escape,
  );
  const need = useCompileStore((state) => codeExecutionNeed(state.errors));
  const target = useCompileTarget((root) => (root.format === null ? null : root.mainDoc));
  const compiled = useCompileStore((state) => state.lastAttemptIdentity?.mainDocument ?? null);
  const followed = target !== null && target === compiled ? target : null;
  const restricted = useFolderAccessStore((state) => folderIsRestricted(state, projectId));
  const viewer = useCollabSettingsLocked(projectId);
  const [saving, setSaving] = useState(false);
  if (!projectId || !need || restricted) return null;
  if (followed === null ? !blocked : viewer) return null;
  const allow = async () => {
    setSaving(true);
    try {
      if (followed === null) await applyShellEscape(true, { recompile: true });
      else await chooseMainDocument(followed, { compile: true });
    } catch (error) {
      notifyError("choose the main document", error);
    } finally {
      setSaving(false);
    }
  };
  const message = () => {
    if (followed !== null) {
      return t(($) => $.shell.codeExecution.followed, { name: basename(followed) });
    }
    if (need === "needed") return t(($) => $.shell.codeExecution.needed);
    if (need === "skipped") return t(($) => $.shell.codeExecution.skipped);
    return t(($) => $.shell.codeExecution.storedResults);
  };
  return (
    <WorkspaceBanner tone="primary" data-testid="code-execution-banner" data-need={need}>
      <ShieldAlert aria-hidden className="size-3.5 shrink-0 text-primary" />
      <p className="min-w-0 flex-1">{message()}</p>
      <WorkspaceBannerButton
        tone="primary"
        className="text-primary"
        disabled={saving}
        onClick={() => void allow()}
      >
        {saving ? <Spinner size="xs" /> : null}
        {followed === null
          ? t(($) => $.shell.codeExecution.allow)
          : t(($) => $.shell.openedFolder.picker.use)}
      </WorkspaceBannerButton>
    </WorkspaceBanner>
  );
}
