import { Trans, useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ChevronDown,
  FileText,
  Info,
  Loader2,
  Play,
  RefreshCw,
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
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { resolveEffectiveMainDoc } from "@/lib/tex-root";
import type { TexFlavor } from "@/lib/tauri";
import { cn, shortcut } from "@/lib/utils";
import { E2E_HOOKS } from "@/lib/e2e-flags";

function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(slash + 1) : path;
}

/**
 * Shows which document a compile would actually build when the active file's
 * `% !TEX root` magic comment overrides the stored main document, and warns
 * when that comment points at a file that does not exist.
 */
function TexRootIndicator() {
  const { t } = useTranslation(["shell"]);
  // Flattened so the shallow comparison only re-renders when the effective
  // root, its provenance, or the broken-target details really change.
  const [mainDoc, overriddenBy, brokenIn, brokenTarget] = useFilesStore(
    useShallow(() => {
      const effective = resolveEffectiveMainDoc();
      return [
        effective.mainDoc,
        effective.overriddenBy,
        effective.brokenRoot?.declaredIn ?? null,
        effective.brokenRoot?.target ?? null,
      ] as const;
    }),
  );

  if (brokenIn !== null) {
    return (
      <Tooltip
        label={t(($) => $.shell.compile.texRootBroken, {
          file: brokenIn,
          target: brokenTarget,
        })}
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
export function CompileControls() {
  const { t } = useTranslation(["shell"]);
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
  const compiling = status === "compiling";
  const hasCompileResult = status === "success" || status === "error";
  const compileLabel = hasCompileResult
    ? t(($) => $.shell.compile.recompile)
    : t(($) => $.shell.compile.compile);
  const renderCompileIcon = () => {
    if (compiling) return <Loader2 className="size-3.5 animate-spin" />;
    if (hasCompileResult) return <RefreshCw className="size-3.5" />;
    return <Play className="size-3.5" />;
  };

  return (
  <>
  <TexRootIndicator />
  <ButtonGroup data-tour="project-compile" className="shrink-0">
    <Tooltip
      label={t(($) => $.shell.compile.runTooltip, {
        action: compileLabel,
        engine: engine.label,
        shortcut: shortcut("⌘↵"),
      })}
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
          "rounded-md bg-primary text-white shadow-sm hover:bg-primary",
          "h-7 gap-1.5 px-2.5",
          // Set here rather than by ButtonGroup: the tooltip wrapper sits
          // between the group and this button.
          "rounded-r-none",
        )}
        disabled={compiling || !engineLoaded}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          // If the PDF pane is hidden (editor-only), reveal it so the result shows.
          if (viewMode === "editor") setViewMode("split");
          void recompile();
        }}
        aria-label={compileLabel}
      >
        {renderCompileIcon()}
        <span className="text-xs font-medium">{compileLabel}</span>
      </Button>
    </Tooltip>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          data-testid="compile-options-button"
          variant="ghost"
          size="sm"
          className={cn(
            "rounded-md rounded-l-none bg-primary text-white shadow-sm hover:bg-primary",
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
                if (value === "tectonic") {
                  void setEngine("xetex");
                } else {
                  void setEngine(
                    "latexmk",
                    value === "auto" ? null : (value as TexFlavor),
                  );
                }
              }}
            >
              <DropdownMenuRadioItem value="tectonic" data-testid="compiler-tectonic">
                <Trans
                  ns="shell"
                  i18nKey={($) => $.shell.compile.compiler.tectonic}
                  components={{ note: <span className="ml-1 text-muted-foreground" /> }}
                />
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="auto" data-testid="compiler-auto">
                <Trans
                  ns="shell"
                  i18nKey={($) => $.shell.compile.compiler.auto}
                  components={{ note: <span className="ml-1 text-muted-foreground" /> }}
                />
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="pdflatex" data-testid="compiler-pdflatex">
                <Trans
                  ns="shell"
                  i18nKey={($) => $.shell.compile.compiler.pdflatex}
                  components={{ note: <span className="ml-1 text-muted-foreground" /> }}
                />
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="xelatex" data-testid="compiler-xelatex">
                <Trans
                  ns="shell"
                  i18nKey={($) => $.shell.compile.compiler.xelatex}
                  components={{ note: <span className="ml-1 text-muted-foreground" /> }}
                />
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="lualatex" data-testid="compiler-lualatex">
                <Trans
                  ns="shell"
                  i18nKey={($) => $.shell.compile.compiler.lualatex}
                  components={{ note: <span className="ml-1 text-muted-foreground" /> }}
                />
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
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
          disabled={compiling || !engineLoaded}
          onSelect={() => {
            if (viewMode === "editor") setViewMode("split");
            void recompile({ fromScratch: true });
          }}
        >
          {t(($) => $.shell.compile.fromScratch)}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </ButtonGroup>
  </>
  );
}
