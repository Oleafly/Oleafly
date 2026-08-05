import {
  AlertTriangle,
  ChevronDown,
  FileText,
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
import { cn, shortcut } from "@/lib/utils";

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
        label={`% !TEX root in ${brokenIn} points to a missing file (${brokenTarget})`}
      >
        <span
          data-testid="tex-root-broken"
          className="flex max-w-40 items-center gap-1 truncate text-xs text-amber-600 dark:text-amber-400"
        >
          <AlertTriangle className="size-3.5 shrink-0" />
          <span className="truncate">TEX root</span>
        </span>
      </Tooltip>
    );
  }
  if (overriddenBy === null) return null;
  return (
    <Tooltip
      label={`root: ${mainDoc} — set by % !TEX root in ${overriddenBy}`}
    >
      <span
        data-testid="tex-root-indicator"
        className="flex max-w-40 items-center gap-1 truncate text-xs text-muted-foreground"
      >
        <FileText className="size-3.5 shrink-0" />
        <span className="truncate">root: {basename(mainDoc)}</span>
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
  const compileLabel = hasCompileResult ? "Recompile" : "Compile";

  return (
  <>
  <TexRootIndicator />
  <ButtonGroup>
    <Tooltip label={`${compileLabel} ${engine.label} (${shortcut("⌘↵")})`}>
      <Button
        data-testid="compile-button"
        data-tour="project-compile"
        {...(import.meta.env.DEV
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
        onClick={() => {
          // If the PDF pane is hidden (editor-only), reveal it so the result shows.
          if (viewMode === "editor") setViewMode("split");
          void recompile();
        }}
        aria-label={compileLabel}
      >
        {compiling ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : hasCompileResult ? (
          <RefreshCw className="size-3.5" />
        ) : (
          <Play className="size-3.5" />
        )}
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
          aria-label="Compile options"
        >
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Auto compile</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={autoCompile ? "on" : "off"}
          onValueChange={(value) => setAutoCompile(value === "on")}
        >
          <DropdownMenuRadioItem value="on">On</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="off">Off</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Compile mode</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={compileMode}
          onValueChange={(value) =>
            setCompileMode(value === "fast" ? "fast" : "normal")
          }
        >
          <DropdownMenuRadioItem value="normal">
            Normal
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="fast">
            Fast{" "}
            <span className="ml-1 text-muted-foreground">[draft]</span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Syntax checks</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={checkSyntaxBeforeCompile ? "check" : "skip"}
          onValueChange={(value) =>
            setCheckSyntaxBeforeCompile(value === "check")
          }
        >
          <DropdownMenuRadioItem value="check">
            Check syntax before compile
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="skip">
            Don’t check syntax
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        {engine.source_format === "latex" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Engine (this project)</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={engine.id === "latexmk" ? "latexmk" : "tectonic"}
              onValueChange={(value) => {
                const isLatexmk = engine.id === "latexmk";
                if (value === "latexmk" && !isLatexmk) void setEngine("latexmk");
                // "xetex" is the stored default for the bundled Tectonic engine.
                if (value === "tectonic" && isLatexmk) void setEngine("xetex");
              }}
            >
              <DropdownMenuRadioItem value="tectonic">
                Tectonic <span className="ml-1 text-muted-foreground">[built in]</span>
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="latexmk">
                latexmk <span className="ml-1 text-muted-foreground">[system TeX]</span>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Compile error handling</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={stopOnFirstError ? "stop" : "continue"}
          onValueChange={(value) =>
            setStopOnFirstError(value === "stop")
          }
        >
          <DropdownMenuRadioItem value="stop">
            Stop on first error
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="continue">
            Try to compile despite errors
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!compiling}
          onSelect={() => void stopCompile()}
        >
          Stop compilation
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={compiling || !engineLoaded}
          onSelect={() => {
            if (viewMode === "editor") setViewMode("split");
            void recompile({ fromScratch: true });
          }}
        >
          Recompile from scratch
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </ButtonGroup>
  </>
  );
}
