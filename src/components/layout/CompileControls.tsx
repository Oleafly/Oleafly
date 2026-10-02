import { Trans, useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ChevronDown,
  FileText,
  Info,
  Play,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { CompileOfferButton } from "@/components/preview/CompileOfferButton";
import { useCompileStore } from "@/store/compile";
import { engineSwitchToastKey, useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { usePreviewDetachedStore } from "@/store/preview-detached";
import { resolveEffectiveMainDoc } from "@/lib/tex-root";
import { mainDocumentMissing } from "@/lib/main-document";
import { folderIsRestricted, useFolderAccessStore } from "@/store/folder-access";
import type { TexFlavor } from "@/lib/tauri";
import { cn, shortcut } from "@/lib/utils";
import { E2E_HOOKS } from "@/lib/e2e-flags";
import { logError } from "@/lib/log";
import { toast } from "@/lib/toast";
import { decodeAppError, describeError } from "@/lib/app-error";
import { basename } from "@/lib/path-utils";
import { Spinner } from "@/components/ui/spinner";

/**
 * Shows which document a compile would actually build when the active file's
 * `% !TEX root` magic comment overrides the stored main document, and warns
 * when that comment points at a file that does not exist.
 */
function TexRootIndicator() {
  const { t } = useTranslation(["shell"]);
  // Flattened so the shallow comparison only re-renders when the effective
  // root, its provenance, or the broken-target details really change.
  const [mainDoc, overriddenBy, brokenIn, brokenTarget, brokenReason] = useFilesStore(
    useShallow(() => {
      const effective = resolveEffectiveMainDoc();
      return [
        effective.mainDoc,
        effective.overriddenBy,
        effective.brokenRoot?.declaredIn ?? null,
        effective.brokenRoot?.target ?? null,
        effective.brokenRoot?.reason ?? null,
      ] as const;
    }),
  );

  if (brokenIn !== null) {
    const details = { file: brokenIn, target: brokenTarget };
    return (
      <Tooltip
        label={
          brokenReason === "not_tex"
            ? t(($) => $.shell.compile.texRootNotTex, details)
            : t(($) => $.shell.compile.texRootBroken, details)
        }
      >
        <span
          data-testid="tex-root-broken"
          className="flex max-w-40 items-center gap-1 truncate text-xs text-amber-600 dark:text-amber-400"
        >
          <AlertTriangle className="size-3.5 shrink-0" />
          <span className="truncate">{t(($) => $.shell.compile.texRootLabel)}</span>
        </span>
      </Tooltip>
    );
  }
  if (overriddenBy === null) return null;
  return (
    <Tooltip
      label={t(($) => $.shell.compile.texRootOverride, {
        path: mainDoc,
        file: overriddenBy,
      })}
    >
      <span
        data-testid="tex-root-indicator"
        className="flex max-w-40 items-center gap-1 truncate text-xs text-muted-foreground"
      >
        <FileText className="size-3.5 shrink-0" />
        <span className="truncate">{t(($) => $.shell.compile.texRootName, { name: basename(mainDoc) })}</span>
      </span>
    </Tooltip>
  );
}

/**
 * The compile action and its options menu, joined as one split control.
 *
 * The menu owns the settings that change how the next compile runs, so it lives
 * with the button that starts one rather than in the settings dialog.
 */
export function CompileControls({ iconOnly = false }: Readonly<{ iconOnly?: boolean }> = {}) {
  const projectId = useFilesStore((s) => s.projectId);
  const detached = usePreviewDetachedStore((s) => projectId !== null && s.projectId === projectId);
  const engine = useFilesStore((s) => s.engine);
  const engineLoaded = useFilesStore((s) => s.engineLoaded);
  const setEngine = useFilesStore((s) => s.setEngine);
  const viewMode = useSettingsStore((s) => s.viewMode);
  const setViewMode = useSettingsStore((s) => s.setViewMode);
  const recompile = useCompileStore((s) => s.recompile);
  const stopCompile = useCompileStore((s) => s.stopCompile);
  const autoCompile = useCompileStore((s) => s.autoCompile);
  const setAutoCompile = useCompileStore((s) => s.setAutoCompile);
  const compileMode = useCompileStore((s) => s.compileMode);
  const setCompileMode = useCompileStore((s) => s.setCompileMode);
  const checkSyntaxBeforeCompile = useCompileStore(
    (s) => s.checkSyntaxBeforeCompile,
  );
  const setCheckSyntaxBeforeCompile = useCompileStore(
    (s) => s.setCheckSyntaxBeforeCompile,
  );
  const stopOnFirstError = useCompileStore((s) => s.stopOnFirstError);
  const setStopOnFirstError = useCompileStore((s) => s.setStopOnFirstError);
  const status = useCompileStore((s) => s.status);
  const compileRevision = useCompileStore(
    (s) => s.lastCompileCheckpoint?.outputRevision ?? 0,
  );
  const { t } = useTranslation(["shell"]);
  const noMainDocument = useFilesStore(mainDocumentMissing);
  const systemTexLocked = useFolderAccessStore((s) => folderIsRestricted(s, projectId));
  const grantTrust = useFolderAccessStore((s) => s.grant);
  return <>
    <TexRootIndicator />
    <CompileControlsView
      iconOnly={iconOnly}
      blockedReason={noMainDocument ? t(($) => $.shell.openedFolder.noMain) : null}
      systemTexLocked={systemTexLocked}
      onTrustForSystemTex={() => void grantTrust("folder")}
      engine={engine}
      engineLoaded={engineLoaded}
      setEngine={setEngine}
      stopCompile={stopCompile}
      autoCompile={autoCompile}
      setAutoCompile={setAutoCompile}
      compileMode={compileMode}
      setCompileMode={setCompileMode}
      checkSyntaxBeforeCompile={checkSyntaxBeforeCompile}
      setCheckSyntaxBeforeCompile={setCheckSyntaxBeforeCompile}
      stopOnFirstError={stopOnFirstError}
      setStopOnFirstError={setStopOnFirstError}
      status={status}
      compileRevision={compileRevision}
      recompile={(options) => {
        if (viewMode === "editor" && !detached) setViewMode("split");
        return recompile(options);
      }}
    />
    {(viewMode === "editor" || detached) && <CompileOfferButton placement="toolbar" />}
  </>;
}

type FileState = ReturnType<typeof useFilesStore.getState>;
type CompileState = ReturnType<typeof useCompileStore.getState>;
export type CompileControlsViewProps = Pick<FileState, "engine" | "engineLoaded" | "setEngine"> &
  Pick<CompileState, "status" | "autoCompile" | "setAutoCompile" | "compileMode" | "setCompileMode" |
    "checkSyntaxBeforeCompile" | "setCheckSyntaxBeforeCompile" | "stopOnFirstError" | "setStopOnFirstError" | "stopCompile"> & {
      compileRevision: number;
      iconOnly?: boolean;
      blockedReason?: string | null;
      systemTexLocked?: boolean;
      onTrustForSystemTex?: () => void;
      recompile: (options?: { fromScratch?: boolean }) => unknown;
    };

export function CompileControlsView({
  engine, engineLoaded, setEngine, recompile, stopCompile, autoCompile, setAutoCompile, compileMode, setCompileMode, checkSyntaxBeforeCompile, setCheckSyntaxBeforeCompile, stopOnFirstError, setStopOnFirstError, status, compileRevision, iconOnly = false,
  blockedReason = null, systemTexLocked = false, onTrustForSystemTex,
}: Readonly<CompileControlsViewProps>) {
  const { t } = useTranslation(["shell", "errors"]);
  const blocked = blockedReason !== null;
  const compiling = status === "compiling";
  const hasCompileResult = status === "success" || status === "error";
  const compileLabel = hasCompileResult
    ? t(($) => $.shell.compile.recompile)
    : t(($) => $.shell.compile.compile);
  const renderCompileIcon = () => {
    if (compiling) return <Spinner size="sm" />;
    if (hasCompileResult) return <RefreshCw className="size-3.5" />;
    return <Play className="size-3.5" />;
  };

  return (
  <ButtonGroup data-tour="project-compile" className="shrink-0">
    <Tooltip
      label={
        blockedReason ??
        t(($) => $.shell.compile.runTooltip, {
          action: compileLabel,
          engine: engine.label,
          shortcut: shortcut("⌘↵"),
        })
      }
    >
      <Button
        data-testid="compile-button"
        {...(E2E_HOOKS
          ? {
              "data-e2e-compile-status": status,
              "data-e2e-compile-revision": compileRevision,
            }
          : {})}
        variant="ghost"
        size="sm"
        className={cn(
          "rounded-md bg-primary text-white shadow-sm hover:bg-primary hover:text-white",
          "h-7 gap-1.5 px-2.5",
          // Set here rather than by ButtonGroup: the tooltip wrapper sits
          // between the group and this button.
          "rounded-r-none",
          blocked && "cursor-not-allowed opacity-50",
        )}
        disabled={!blocked && (compiling || !engineLoaded)}
        aria-disabled={blocked || undefined}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (blocked) return;
          void recompile();
        }}
        aria-label={compileLabel}
      >
        {renderCompileIcon()}
        <span data-toolbar-part="compile-label" aria-hidden={iconOnly || undefined}
          className={cn("whitespace-nowrap text-xs font-medium", iconOnly && "invisible absolute")}>{compileLabel}</span>
      </Button>
    </Tooltip>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          data-testid="compile-options-button"
          variant="ghost"
          size="sm"
          className={cn(
            "rounded-md rounded-l-none bg-primary text-white shadow-sm hover:bg-primary hover:text-white data-[state=open]:text-white",
            "h-7 border-l border-white/25 px-1.5",
          )}
          // Openable while compiling, otherwise "Stop compilation" inside is
          // unreachable: it is the one item that requires a running compile,
          // and the trigger used to close the menu off for exactly that state.
          // Everything else here is a preference that applies to the next
          // compile, and "Recompile from scratch" disables itself.
          disabled={!engineLoaded}
          aria-label={t(($) => $.shell.compile.options)}
        >
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>{t(($) => $.shell.compile.autoCompile.title)}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={autoCompile ? "on" : "off"}
          onValueChange={(value) => setAutoCompile(value === "on")}
        >
          <DropdownMenuRadioItem value="on">
            {t(($) => $.shell.compile.autoCompile.on)}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="off">
            {t(($) => $.shell.compile.autoCompile.off)}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t(($) => $.shell.compile.mode.title)}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={compileMode}
          onValueChange={(value) =>
            setCompileMode(value === "fast" ? "fast" : "normal")
          }
        >
          <DropdownMenuRadioItem value="normal">
            {t(($) => $.shell.compile.mode.normal)}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="fast">
            <Trans
              ns="shell"
              i18nKey={($) => $.shell.compile.mode.fast}
              components={{ note: <span className="ml-1 text-muted-foreground" /> }}
            />
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t(($) => $.shell.compile.syntax.title)}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={checkSyntaxBeforeCompile ? "check" : "skip"}
          onValueChange={(value) =>
            setCheckSyntaxBeforeCompile(value === "check")
          }
        >
          <DropdownMenuRadioItem value="check">
            {t(($) => $.shell.compile.syntax.check)}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="skip">
            {t(($) => $.shell.compile.syntax.skip)}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        {engine.source_format === "latex" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center gap-1.5">
              {t(($) => $.shell.compile.compiler.title)}
              <Tooltip
                wide
                side="right"
                label={t(($) => $.shell.compile.compiler.help)}
              >
                <Info className="size-3 cursor-help text-muted-foreground/60 hover:text-muted-foreground" />
              </Tooltip>
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={
                engine.id === "latexmk"
                  ? (engine.tex_flavor ?? "auto")
                  : "tectonic"
              }
              onValueChange={(value) => {
                const current =
                  engine.id === "latexmk"
                    ? (engine.tex_flavor ?? "auto")
                    : "tectonic";
                if (value === current) return;
                // "xetex" is the stored default for the bundled Tectonic
                // engine. Everything else runs through latexmk on a system
                // TeX: "auto" picks the compiler from the source, an explicit
                // choice pins it (Overleaf's Compiler setting).
                const flavor = value === "auto" ? null : (value as TexFlavor);
                const switched =
                  value === "tectonic"
                    ? setEngine("xetex")
                    : setEngine("latexmk", flavor);
                void switched.catch((error: unknown) => {
                  void logError("switch compile engine", error);
                  const projectId = useFilesStore.getState().projectId;
                  if (!projectId) return;
                  toast.errorUnique(
                    engineSwitchToastKey(projectId),
                    decodeAppError(error)
                      ? describeError(error)
                      : t(($) => $.shell.enginePicker.switchFailed),
                  );
                });
              }}
            >
              <DropdownMenuRadioItem value="tectonic" data-testid="compiler-tectonic">
                <Trans
                  ns="shell"
                  i18nKey={($) => $.shell.compile.compiler.tectonic}
                  components={{ note: <span className="ml-1 text-muted-foreground" /> }}
                />
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="auto" data-testid="compiler-auto" disabled={systemTexLocked}>
                <Trans
                  ns="shell"
                  i18nKey={($) => $.shell.compile.compiler.auto}
                  components={{ note: <span className="ml-1 text-muted-foreground" /> }}
                />
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="pdflatex" data-testid="compiler-pdflatex" disabled={systemTexLocked}>
                <Trans
                  ns="shell"
                  i18nKey={($) => $.shell.compile.compiler.pdflatex}
                  components={{ note: <span className="ml-1 text-muted-foreground" /> }}
                />
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="xelatex" data-testid="compiler-xelatex" disabled={systemTexLocked}>
                <Trans
                  ns="shell"
                  i18nKey={($) => $.shell.compile.compiler.xelatex}
                  components={{ note: <span className="ml-1 text-muted-foreground" /> }}
                />
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="lualatex" data-testid="compiler-lualatex" disabled={systemTexLocked}>
                <Trans
                  ns="shell"
                  i18nKey={($) => $.shell.compile.compiler.lualatex}
                  components={{ note: <span className="ml-1 text-muted-foreground" /> }}
                />
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            {systemTexLocked && (
              <DropdownMenuItem
                data-testid="compiler-trust"
                className="items-start gap-2 text-xs text-muted-foreground"
                onSelect={() => onTrustForSystemTex?.()}
              >
                <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <span className="whitespace-normal">{t(($) => $.errors.trust.system_tex)}</span>
              </DropdownMenuItem>
            )}
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t(($) => $.shell.compile.errors.title)}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={stopOnFirstError ? "stop" : "continue"}
          onValueChange={(value) =>
            setStopOnFirstError(value === "stop")
          }
        >
          <DropdownMenuRadioItem value="stop">
            {t(($) => $.shell.compile.errors.stop)}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="continue">
            {t(($) => $.shell.compile.errors.continue)}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!compiling}
          onSelect={() => void stopCompile()}
        >
          {t(($) => $.shell.compile.stop)}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={blocked || compiling || !engineLoaded}
          onSelect={() => {
            void recompile({ fromScratch: true });
          }}
        >
          {t(($) => $.shell.compile.fromScratch)}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </ButtonGroup>
  );
}
