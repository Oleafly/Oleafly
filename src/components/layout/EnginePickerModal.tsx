import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Cpu, Download, ShieldAlert, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModalShell } from "@/components/ui/modal-shell";
import {
  dismissEngineHint,
  useEnginePickerStore,
} from "@/store/engine-picker";
import { installPhaseLabel, TINYTEX_INSTALL_TOAST_KEY, useEngineStore } from "@/store/engine";
import { engineSwitchToastKey, useFilesStore } from "@/store/files";
import {
  latexmkFixesFinding,
  needsPdflatexFinding,
  needsShellEscapeFinding,
  type ImportCompatFinding,
} from "@oleafly/latex";
import { toast } from "@/lib/toast";
import { useDisplayPath } from "@/lib/display-path";
import { decodeAppError, describeError } from "@/lib/app-error";
import { applyShellEscape } from "@/lib/latex-compile-actions";
import { recompileWithPreview } from "@/lib/compile-preview";
import { TrustRequiredNotice } from "@/components/open-folder/TrustRequiredNotice";
import { folderIsRestricted, useFolderAccessStore } from "@/store/folder-access";
import { logError } from "@/lib/log";
import { formatList } from "@/lib/intl";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";

const LEVEL_DOT: Record<ImportCompatFinding["level"], string> = {
  blocker: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-muted-foreground/50",
};

/**
 * The three-way engine choice for projects that need tools beyond Tectonic
 * (minted, glossaries/makeindex, pythontex, shell-escape-heavy templates).
 */
export function EnginePickerModal() {
  const { t } = useTranslation(["common", "shell", "errors"]);
  const displayPath = useDisplayPath();
  const open = useEnginePickerStore((s) => s.open);
  const source = useEnginePickerStore((s) => s.source);
  const findings = useEnginePickerStore((s) => s.findings);
  const close = useEnginePickerStore((s) => s.close);

  const projectId = useFilesStore((s) => s.projectId);
  const engineId = useFilesStore((s) => s.engine.id);
  const setEngine = useFilesStore((s) => s.setEngine);
  const setShellEscape = useFilesStore((s) => s.setShellEscape);
  const systemTexLocked = useFolderAccessStore((s) => folderIsRestricted(s, projectId));

  const info = useEngineStore((s) => s.info);
  const installing = useEngineStore((s) => s.installing);
  const installPhase = useEngineStore((s) => s.installPhase);
  const progress = useEngineStore((s) => s.progress);
  const partialDownloadBytes = useEngineStore((s) => s.partialDownloadBytes);
  const ensureLoaded = useEngineStore((s) => s.ensureLoaded);
  const install = useEngineStore((s) => s.install);

  const [switching, setSwitching] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (open) void ensureLoaded();
  }, [open, ensureLoaded]);

  if (!open) return null;

  const hasSystemTex = !!info?.latexmk;
  const alreadyLatexmk = engineId === "latexmk";
  const fixable = findings.filter((finding) => latexmkFixesFinding(finding.id));
  const needsShellEscape = findings.some((finding) => needsShellEscapeFinding(finding.id));
  const needsPdflatex = findings.some((finding) => needsPdflatexFinding(finding.id));

  const reportSwitchFailure = (scope: string, error: unknown, message: string) => {
    void logError(scope, error);
    toast.errorUnique(
      engineSwitchToastKey(projectId ?? ""),
      decodeAppError(error) ? describeError(error) : message,
    );
  };

  const pinLatexmk = async (afterInstall: boolean) => {
    setSwitching(true);
    let engineSwitched = false;
    try {
      await setEngine("latexmk", needsPdflatex ? "pdflatex" : null);
      const selected = useFilesStore.getState();
      if (selected.projectId !== projectId || selected.engine.id !== "latexmk") return;
      engineSwitched = true;
      if (needsShellEscape) await setShellEscape(true);
      if (useFilesStore.getState().projectId !== projectId) return;
      const engineName = needsPdflatex
        ? t(($) => $.shell.enginePicker.engineNames.pdflatexViaLatexmk)
        : t(($) => $.shell.enginePicker.engineNames.latexmk);
      if (afterInstall) {
        toast.successUnique(
          TINYTEX_INSTALL_TOAST_KEY,
          t(($) => $.shell.enginePicker.switchedAfterInstall, { engine: engineName }),
        );
      } else {
        toast.success(t(($) => $.shell.enginePicker.switched, { engine: engineName }));
      }
      close();
      if (source === "compile-failure") void recompileWithPreview();
    } catch (error) {
      if (engineSwitched) {
        reportSwitchFailure(
          "update external command access",
          error,
          t(($) => $.shell.enginePicker.shellEscapeFailed),
        );
      } else {
        reportSwitchFailure(
          "switch compile engine",
          error,
          t(($) => $.shell.enginePicker.switchFailed),
        );
      }
    } finally {
      setSwitching(false);
    }
  };

  const recompileHere = async () => {
    const blocked = needsShellEscape && !useFilesStore.getState().engine.allow_shell_escape;
    if (blocked) {
      setSwitching(true);
      const allowed = await applyShellEscape(true);
      setSwitching(false);
      if (!allowed) return;
    }
    close();
    void recompileWithPreview();
  };

  const chooseSystemTex = () =>
    useFilesStore.getState().engine.id === "latexmk" ? recompileHere() : pinLatexmk(false);

  const installThenPin = async () => {
    await install();
    // install() surfaces its own failure toast; only pin when latexmk exists.
    if (useEngineStore.getState().info?.latexmk) {
      await pinLatexmk(true);
    }
  };

  const keepTectonic = async () => {
    if (projectId) dismissEngineHint(projectId, findings);
    void import("@/store/compile").then(({ useCompileStore }) => {
      const { offer, dismissOffer } = useCompileStore.getState();
      if (offer?.kind === "engine-gap" && offer.projectId === projectId) dismissOffer();
    });
    // For a latexmk project this is a real switch back, not just a dismissal
    // ("xetex" is the stored name of the bundled Tectonic engine).
    if (alreadyLatexmk) {
      try {
        await setEngine("xetex");
      } catch (error) {
        reportSwitchFailure(
          "switch compile engine",
          error,
          t(($) => $.shell.enginePicker.switchFailed),
        );
      }
    }
    close();
  };

  const tinytexActionLabel = () => {
    if (installing) {
      return installPhaseLabel(installPhase, progress);
    }
    if (partialDownloadBytes > 0) {
      return t(($) => $.shell.enginePicker.tinytex.resume, {
        megabytes: Math.round(partialDownloadBytes / 1_000_000),
      });
    }
    return t(($) => $.shell.enginePicker.tinytex.download);
  };

  const systemTexActionLabel = () => {
    if (alreadyLatexmk) {
      return t(($) => $.shell.compile.recompile);
    }
    if (needsPdflatex) {
      return t(($) => $.shell.enginePicker.systemTex.switchPdflatex);
    }
    return t(($) => $.shell.enginePicker.systemTex.use);
  };

  const renderSystemTexOption = () => (
    <div
      className={cn(
        "rounded-lg border p-3",
        hasSystemTex && "border-primary/60",
      )}
    >
      <div className="flex items-center gap-2">
        <Cpu className="size-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium">
          {needsPdflatex
            ? t(($) => $.shell.enginePicker.systemTex.titlePdflatex)
            : t(($) => $.shell.enginePicker.systemTex.title)}
        </span>
        {hasSystemTex && (
          <Badge variant="primaryGhost" size="sm">
            {t(($) => $.shell.enginePicker.recommended)}
          </Badge>
        )}
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        {hasSystemTex
          ? t(($) => $.shell.enginePicker.systemTex.found)
          : t(($) => $.shell.enginePicker.systemTex.missing)}
      </p>
      <TrustRequiredNotice
        projectId={projectId}
        reason={t(($) => $.errors.trust.system_tex)}
        className="mt-2"
      />
      {info?.latexmk && (
        <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground/70">
          {displayPath(info.latexmk)}
        </p>
      )}
      {needsShellEscape && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <ShieldAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
          {t(($) => $.shell.enginePicker.shellEscape.included)}
        </p>
      )}
      <div className="mt-2">
        <Button
          size="sm"
          data-testid="engine-picker-use-system"
          disabled={!hasSystemTex || switching || systemTexLocked}
          onClick={() => void chooseSystemTex()}
          data-modal-initial-focus={hasSystemTex || undefined}
        >
          {switching ? <Spinner size="sm" /> : null}
          {systemTexActionLabel()}
        </Button>
      </div>
    </div>
  );

  return (
    <ModalShell
      open
      onClose={close}
      closeLabel={t(($) => $.common.actions.close)}
      layer="nested"
      width="lg"
      labelledBy={titleId}
      testId="engine-picker-modal"
      className="flex flex-col gap-4 p-5"
    >
      <div>
        <h2 id={titleId} className="text-sm font-semibold">
          {source === "compile-failure"
            ? t(($) => $.shell.enginePicker.titleCompileFailure)
            : t(($) => $.shell.enginePicker.titleImportScan)}
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {source === "compile-failure"
            ? t(($) => $.shell.enginePicker.descriptionCompileFailure)
            : t(($) => $.shell.enginePicker.descriptionImportScan)}
        </p>
      </div>

      {findings.length > 0 && (
        <ul className="flex flex-col gap-1.5 rounded-lg border bg-muted/30 p-3">
          {findings.map((finding) => (
            <li key={finding.id} className="flex items-start gap-2 text-xs">
              <span
                className={cn(
                  "mt-1 size-1.5 shrink-0 rounded-full",
                  LEVEL_DOT[finding.level],
                )}
              />
              <div className="min-w-0">
                <span className="font-medium">{finding.title}</span>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {finding.detail}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        {/* Option 1: system TeX via latexmk */}
        {renderSystemTexOption()}

        {/* Option 2: on-demand TinyTeX (hidden when a system TeX already covers it) */}
        {!hasSystemTex && (
          <div className="rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <Download className="size-4 shrink-0 text-muted-foreground" />
              <span className="text-sm font-medium">
                {t(($) => $.shell.enginePicker.tinytex.title)}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {t(($) => $.shell.enginePicker.tinytex.description)}
            </p>
            <div className="mt-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={installing || switching || systemTexLocked}
                onClick={() => void installThenPin()}
              >
                {installing ? <Spinner size="sm" /> : null}
                {tinytexActionLabel()}
              </Button>
            </div>
          </div>
        )}

        {/* Option 3: stay on Tectonic */}
        <div className="rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <Zap className="size-4 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium">
              {t(($) => $.shell.enginePicker.tectonic.title)}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {fixable.length > 0
              ? t(($) => $.shell.enginePicker.tectonic.withFailures, {
                  count: fixable.length,
                  features: formatList(fixable.map((f) => f.title)),
                })
              : t(($) => $.shell.enginePicker.tectonic.description)}
          </p>
          <div className="mt-2">
            <Button
              size="sm"
              variant="ghost"
              data-testid="engine-picker-keep-tectonic"
              onClick={() => void keepTectonic()}
            >
              {alreadyLatexmk
                ? t(($) => $.shell.enginePicker.tectonic.switchBack)
                : t(($) => $.shell.enginePicker.tectonic.keep)}
            </Button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
