import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
import { needsShellEscapeFinding } from "@oleafly/latex";
import { Spinner } from "@/components/ui/spinner";
import { WorkspaceBanner, WorkspaceBannerButton } from "@/components/ui/workspace-banner";
import { applyShellEscape } from "@/lib/latex-compile-actions";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { folderIsRestricted, useFolderAccessStore } from "@/store/folder-access";

const DENIED_CODE = "tex.shell_escape_denied_";

export function ShellCommandsBanner() {
  const { t } = useTranslation(["shell"]);
  const projectId = useFilesStore((state) => state.projectId);
  const blockedOnSystemTex = useFilesStore(
    (state) => state.engine.id === "latexmk" && !state.engine.allow_shell_escape,
  );
  const needed = useCompileStore(
    (state) =>
      state.errors.some((error) => error.code?.startsWith(DENIED_CODE) ?? false) ||
      (state.offer?.kind === "engine-gap" &&
        state.offer.projectId === projectId &&
        state.offer.findings.some((finding) => needsShellEscapeFinding(finding.id))),
  );
  const restricted = useFolderAccessStore((state) => folderIsRestricted(state, projectId));
  const [saving, setSaving] = useState(false);
  if (!projectId || !blockedOnSystemTex || !needed || restricted) return null;
  const allow = async () => {
    setSaving(true);
    await applyShellEscape(true, { recompile: true });
    setSaving(false);
  };
  return (
    <WorkspaceBanner tone="primary" data-testid="shell-commands-banner">
      <ShieldAlert aria-hidden className="size-3.5 shrink-0 text-primary" />
      <p className="min-w-0 flex-1">{t(($) => $.shell.shellCommands.banner)}</p>
      <WorkspaceBannerButton
        tone="primary"
        className="text-primary"
        disabled={saving}
        onClick={() => void allow()}
      >
        {saving ? <Spinner size="xs" /> : null}
        {t(($) => $.shell.shellCommands.allow)}
      </WorkspaceBannerButton>
    </WorkspaceBanner>
  );
}
