import { useEffect } from "react";
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
import {
  stopTypstLivePreview,
  syncTypstLivePreview,
  useCompileStore,
  type LivePreviewState,
} from "@/store/compile";
import { engineSwitchToastKey, useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { usePreviewDetachedStore } from "@/store/preview-detached";
import { resolveEffectiveMainDoc } from "@/lib/tex-root";
import { mainDocumentMissing } from "@/lib/main-document";
import { folderIsRestricted, useFolderAccessStore } from "@/store/folder-access";
import type { DocumentEngineDescriptor, TexFlavor, TypstToolchainStatus } from "@/lib/tauri";
import type { TypstOptionsDescriptor } from "@oleafly/backend-port";
import { typstSupports, type TypstOptionsUpdate } from "@/lib/typst-options";
import { applyTypstCompileOptions, chooseTypstVariant } from "@/lib/typst-compile-actions";
import { activeTypstVariant, useTypstVariantStore } from "@/store/typst-variant";
import { cn, shortcut } from "@/lib/utils";
import { compileSettingsForEngine } from "@/lib/document-engine";
import { E2E_HOOKS } from "@/lib/e2e-flags";
import { logError } from "@/lib/log";
import { toast } from "@/lib/toast";
import { decodeAppError, describeError } from "@/lib/app-error";
import { basename } from "@/lib/path-utils";
import { Spinner } from "@/components/ui/spinner";
import {
  installedTypstVersions,
  useTypstToolchainFor,
  useTypstToolchainStore,
} from "@/store/typst-toolchain";

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

function TypstLivePreviewSync() {
  useEffect(syncTypstLivePreview, []);
  return null;
}

function TypstLivePreviewKeeper() {
  const projectId = useFilesStore((s) => s.projectId);
  const typst = useFilesStore((s) => s.engine.source_format === "typst");
  const typstMissing = useFilesStore((s) => s.engine.typst_missing ?? null);
  const engineLoaded = useFilesStore((s) => s.engineLoaded);
  useEffect(() => () => stopTypstLivePreview(), []);
  return <TypstLivePreviewSync key={JSON.stringify([projectId, typst, typstMissing, engineLoaded])} />;
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
  const setTypstVersion = useFilesStore((s) => s.setTypstVersion);
  const typstToolchain = useTypstToolchainFor(engine);
  const typstSelections = useTypstVariantStore((s) => s.selections);
  const refreshTypstToolchain = useTypstToolchainStore((s) => s.refresh);
  const livePreview = useCompileStore((s) => s.livePreview);
  return <>
    <TexRootIndicator />
    <TypstLivePreviewKeeper />
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
      typstToolchain={typstToolchain}
      setTypstVersion={setTypstVersion}
      livePreview={
        livePreview.projectId === projectId
          ? livePreview
          : { projectId, enabled: false, status: "off", message: null }
      }
      onOptionsOpen={() => {
        if (engine.source_format === "typst") void refreshTypstToolchain();
      }}
      typstVariant={activeTypstVariant(projectId, engine, typstSelections)}
      setTypstVariant={chooseTypstVariant}
      setTypstOptions={applyTypstCompileOptions}
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
      typstToolchain?: TypstToolchainStatus | null;
      setTypstVersion?: (version: string | null) => Promise<unknown>;
      onOptionsOpen?: () => void;
      typstVariant?: string | null;
      setTypstVariant?: (variant: string | null) => void;
      setTypstOptions?: (update: TypstOptionsUpdate) => Promise<unknown>;
      livePreview?: LivePreviewState;
    };

const TYPST_NO_VARIANT = "\u0000none";
const SYSTEM_FONTS = "system";
const PROJECT_FONTS = "project";
const STANDARD_BUILD = "standard";
const REPRODUCIBLE_BUILD = "reproducible";
const STOPPABLE_WATCH: ReadonlySet<LivePreviewState["status"]> = new Set(["compiling", "restarting"]);

function MenuGroupLabel({ title, help }: Readonly<{ title: string; help?: string }>) {
  if (!help) return <DropdownMenuLabel>{title}</DropdownMenuLabel>;
  return (
    <DropdownMenuLabel className="flex items-center gap-1.5">
      {title}
      <Tooltip wide side="right" label={help}>
        <Info className="size-3 cursor-help text-muted-foreground/60 hover:text-muted-foreground" />
      </Tooltip>
    </DropdownMenuLabel>
  );
}

function UnsupportedNote() {
  const { t } = useTranslation(["shell"]);
  return <span className="ml-1 text-muted-foreground">{t(($) => $.shell.compile.typstFonts.unsupported)}</span>;
}

function AutoCompileMenuGroup({
  typst,
  autoCompile,
  setAutoCompile,
  livePreview,
}: Readonly<{
  typst: boolean;
  autoCompile: boolean;
  setAutoCompile: (value: boolean) => void;
  livePreview?: LivePreviewState;
}>) {
  const { t } = useTranslation(["shell"]);
  const note = (() => {
    if (!typst || !livePreview?.enabled) return null;
    if (livePreview.status === "failed") return t(($) => $.shell.compile.autoCompile.typstFailed);
    if (livePreview.status === "restarting") return t(($) => $.shell.compile.autoCompile.typstRestarting);
    if (livePreview.status === "starting") return t(($) => $.shell.compile.autoCompile.typstStarting);
    return null;
  })();
  return (
    <>
      <MenuGroupLabel
        title={t(($) => $.shell.compile.autoCompile.title)}
        help={typst ? t(($) => $.shell.compile.autoCompile.typstHelp) : t(($) => $.shell.compile.autoCompile.help)}
      />
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
      {note && livePreview && (
        <p
          data-testid="typst-live-preview-note"
          title={livePreview.status === "failed" ? (livePreview.message ?? undefined) : undefined}
          className={cn(
            "px-2 pb-1 text-[11px] whitespace-normal",
            livePreview.status === "failed" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {note}
        </p>
      )}
    </>
  );
}

function TypstFontsMenuGroup({
  options,
  setTypstOptions,
}: Readonly<{
  options: TypstOptionsDescriptor;
  setTypstOptions: (update: TypstOptionsUpdate) => Promise<unknown>;
}>) {
  const { t } = useTranslation(["shell"]);
  const canIgnoreSystemFonts = typstSupports(options, "--ignore-system-fonts");
  const current =
    canIgnoreSystemFonts && (options.reproducible || !options.system_fonts) ? PROJECT_FONTS : SYSTEM_FONTS;
  return (
    <>
      <DropdownMenuSeparator />
      <MenuGroupLabel
        title={t(($) => $.shell.compile.typstFonts.title)}
        help={t(($) => $.shell.compile.typstFonts.help)}
      />
      <DropdownMenuRadioGroup
        value={current}
        onValueChange={(value) => {
          if (value !== current) void setTypstOptions({ systemFonts: value === SYSTEM_FONTS });
        }}
      >
        <DropdownMenuRadioItem
          value={SYSTEM_FONTS}
          data-testid="typst-system-fonts"
          disabled={canIgnoreSystemFonts && options.reproducible}
        >
          {t(($) => $.shell.compile.typstFonts.systemFonts)}
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value={PROJECT_FONTS} data-testid="typst-project-fonts" disabled={!canIgnoreSystemFonts}>
          {t(($) => $.shell.compile.typstFonts.projectOnly)}
          {!canIgnoreSystemFonts && <UnsupportedNote />}
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </>
  );
}

function TypstBuildMenuGroup({
  options,
  setTypstOptions,
}: Readonly<{
  options: TypstOptionsDescriptor;
  setTypstOptions: (update: TypstOptionsUpdate) => Promise<unknown>;
}>) {
  const { t } = useTranslation(["shell"]);
  const canFixTimestamp = typstSupports(options, "--creation-timestamp");
  const current = options.reproducible ? REPRODUCIBLE_BUILD : STANDARD_BUILD;
  return (
    <>
      <DropdownMenuSeparator />
      <MenuGroupLabel
        title={t(($) => $.shell.compile.typstBuild.title)}
        help={t(($) => $.shell.compile.typstBuild.help)}
      />
      <DropdownMenuRadioGroup
        value={current}
        onValueChange={(value) => {
          if (value !== current) void setTypstOptions({ reproducible: value === REPRODUCIBLE_BUILD });
        }}
      >
        <DropdownMenuRadioItem value={STANDARD_BUILD} data-testid="typst-standard-build">
          {t(($) => $.shell.compile.typstBuild.standard)}
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value={REPRODUCIBLE_BUILD} data-testid="typst-reproducible" disabled={!canFixTimestamp}>
          {t(($) => $.shell.compile.typstBuild.reproducible)}
          {!canFixTimestamp && <UnsupportedNote />}
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </>
  );
}

function TypstVariantMenuGroup({
  variants,
  current,
  setTypstVariant,
}: Readonly<{
  variants: readonly string[];
  current: string | null;
  setTypstVariant: (variant: string | null) => void;
}>) {
  const { t } = useTranslation(["shell"]);
  if (variants.length === 0) return null;
  return (
    <>
      <DropdownMenuSeparator />
      <MenuGroupLabel
        title={t(($) => $.shell.compile.typstVariant.title)}
        help={t(($) => $.shell.compile.typstVariant.help)}
      />
      <DropdownMenuRadioGroup
        value={current ?? TYPST_NO_VARIANT}
        onValueChange={(value) => {
          const next = value === TYPST_NO_VARIANT ? null : value;
          if (next !== current) setTypstVariant(next);
        }}
      >
        <DropdownMenuRadioItem value={TYPST_NO_VARIANT} data-testid="typst-variant-none">
          {t(($) => $.shell.compile.typstVariant.none)}
        </DropdownMenuRadioItem>
        {variants.map((name) => (
          <DropdownMenuRadioItem key={name} value={name} data-testid={`typst-variant-${name}`}>
            {name}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  );
}

const TYPST_DEFAULT_CHOICE = "default";

interface TypstVersionChoice {
  readonly version: string;
  readonly note: "builtIn" | "system" | "missing" | null;
}

function typstVersionChoices(
  engine: DocumentEngineDescriptor,
  toolchain: TypstToolchainStatus | null | undefined,
): TypstVersionChoice[] {
  const choices: TypstVersionChoice[] = (toolchain ? installedTypstVersions(toolchain) : []).map((entry) => {
    if (entry.sources.includes("bundled")) return { version: entry.version, note: "builtIn" };
    if (entry.sources.includes("system") && !entry.sources.includes("downloaded")) {
      return { version: entry.version, note: "system" };
    }
    return { version: entry.version, note: null };
  });
  const pinned = engine.typst_version;
  if (pinned && !choices.some((choice) => choice.version === pinned)) {
    choices.unshift({ version: pinned, note: engine.typst_missing === pinned ? "missing" : null });
  }
  return choices;
}

function TypstVersionMenuGroup({
  engine,
  toolchain,
  setTypstVersion,
}: Readonly<{
  engine: DocumentEngineDescriptor;
  toolchain: TypstToolchainStatus | null | undefined;
  setTypstVersion: (version: string | null) => Promise<unknown>;
}>) {
  const { t } = useTranslation(["shell"]);
  const current = engine.typst_version ?? TYPST_DEFAULT_CHOICE;
  const noteLabel = (note: TypstVersionChoice["note"]) => {
    if (note === "builtIn") return t(($) => $.shell.compile.typstVersion.builtIn);
    if (note === "system") return t(($) => $.shell.compile.typstVersion.system);
    if (note === "missing") return t(($) => $.shell.compile.typstVersion.missing);
    return null;
  };
  return (
    <>
      <DropdownMenuSeparator />
      <MenuGroupLabel
        title={t(($) => $.shell.compile.typstVersion.title)}
        help={t(($) => $.shell.compile.typstVersion.help)}
      />
      <DropdownMenuRadioGroup
        value={current}
        onValueChange={(value) => {
          if (value === current) return;
          const switched = setTypstVersion(value === TYPST_DEFAULT_CHOICE ? null : value);
          void switched.catch((error: unknown) => {
            void logError("switch Typst version", error);
            const projectId = useFilesStore.getState().projectId;
            if (!projectId) return;
            toast.errorUnique(
              engineSwitchToastKey(projectId),
              decodeAppError(error)
                ? describeError(error)
                : t(($) => $.shell.compile.typstVersion.switchFailed),
            );
          });
        }}
      >
        <DropdownMenuRadioItem value={TYPST_DEFAULT_CHOICE} data-testid="typst-version-default">
          {toolchain
            ? t(($) => $.shell.compile.typstVersion.default, { version: toolchain.defaultVersion })
            : t(($) => $.shell.compile.typstVersion.defaultPlain)}
        </DropdownMenuRadioItem>
        {typstVersionChoices(engine, toolchain).map((choice) => {
          const note = noteLabel(choice.note);
          return (
            <DropdownMenuRadioItem
              key={choice.version}
              value={choice.version}
              data-testid={`typst-version-${choice.version}`}
              disabled={choice.note === "missing"}
            >
              {choice.version}
              {note && <span className="ml-1 text-muted-foreground">{note}</span>}
            </DropdownMenuRadioItem>
          );
        })}
      </DropdownMenuRadioGroup>
    </>
  );
}

export function CompileControlsView({
  engine, engineLoaded, setEngine, recompile, stopCompile, autoCompile, setAutoCompile, compileMode, setCompileMode, checkSyntaxBeforeCompile, setCheckSyntaxBeforeCompile, stopOnFirstError, setStopOnFirstError, status, compileRevision, iconOnly = false,
  blockedReason = null, systemTexLocked = false, onTrustForSystemTex,
  typstToolchain = null, setTypstVersion, onOptionsOpen,
  typstVariant = null, setTypstVariant, setTypstOptions, livePreview,
}: Readonly<CompileControlsViewProps>) {
  const { t } = useTranslation(["shell", "errors"]);
  const blocked = blockedReason !== null;
  const settings = compileSettingsForEngine(engine);
  const compiling = status === "compiling";
  const typst = engine.source_format === "typst";
  const watchStoppable = Boolean(livePreview?.enabled && STOPPABLE_WATCH.has(livePreview.status));
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
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) onOptionsOpen?.();
      }}
    >
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
        <AutoCompileMenuGroup
          typst={typst}
          autoCompile={autoCompile}
          setAutoCompile={setAutoCompile}
          livePreview={livePreview}
        />

        {settings.draftMode && (
          <>
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
          </>
        )}

        {settings.syntaxCheck && (
          <>
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
          </>
        )}

        {engine.source_format === "latex" && (
          <>
            <DropdownMenuSeparator />
            <MenuGroupLabel
              title={t(($) => $.shell.compile.compiler.title)}
              help={t(($) => $.shell.compile.compiler.help)}
            />
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

        {typst && setTypstVersion && (
          <TypstVersionMenuGroup engine={engine} toolchain={typstToolchain} setTypstVersion={setTypstVersion} />
        )}

        {typst && engine.typst_options && setTypstOptions && (
          <>
            <TypstFontsMenuGroup options={engine.typst_options} setTypstOptions={setTypstOptions} />
            <TypstBuildMenuGroup options={engine.typst_options} setTypstOptions={setTypstOptions} />
          </>
        )}

        {typst && engine.typst_options && setTypstVariant && (
          <TypstVariantMenuGroup
            variants={engine.typst_options.variants}
            current={typstVariant}
            setTypstVariant={setTypstVariant}
          />
        )}

        {settings.stopOnFirstError && (
          <>
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
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!compiling && !watchStoppable}
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
