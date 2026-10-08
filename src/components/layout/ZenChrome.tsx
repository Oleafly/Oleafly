import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Play, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { WindowControls } from "@/components/layout/WindowControls";
import { recompileWithPreview } from "@/lib/compile-preview";
import { mainDocumentMissing } from "@/lib/main-document";
import { useFullscreen } from "@/lib/use-fullscreen";
import { cn, shortcut } from "@/lib/utils";
import { toggleZenCompileLog } from "@/lib/zen-mode";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { useZenStore } from "@/store/zen";

const CORNER_REACH_PX = 160;
const PILL =
  "flex h-8 items-center gap-1.5 rounded-full border bg-background/95 px-3 text-xs font-medium text-foreground shadow-sm";

export function ZenTitleStrip() {
  const fullscreen = useFullscreen();
  const entering = useZenStore((state) => state.fullscreen === "entering");
  if (fullscreen || entering) return null;
  return (
    <div
      data-testid="zen-title-strip"
      data-tauri-drag-region
      className="flex h-7 shrink-0 items-center justify-end bg-background"
    >
      <WindowControls compact />
    </div>
  );
}

function usePointerNearCorner(): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const onMove = (event: PointerEvent | MouseEvent) => {
      setNear(
        event.clientX >= window.innerWidth - CORNER_REACH_PX &&
          event.clientY >= window.innerHeight - CORNER_REACH_PX,
      );
    };
    const onLeave = () => setNear(false);
    window.addEventListener("pointermove", onMove);
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
    };
  }, []);
  return near;
}

function useCompileFailed(): boolean {
  return useCompileStore((state) => state.status === "error" || state.status === "unavailable");
}

function CompilingPill() {
  const { t } = useTranslation(["shell"]);
  return (
    <output data-testid="zen-compile-pill" className={cn(PILL, "pointer-events-auto")}>
      <Spinner size="sm" />
      {t(($) => $.shell.zen.compiling)}
    </output>
  );
}

function FailedPill() {
  const { t } = useTranslation(["shell"]);
  const logsOpen = useZenStore((state) => state.logsOpen);
  const logLabel = logsOpen ? t(($) => $.shell.zen.hideLog) : t(($) => $.shell.zen.showLog);
  return (
    <Tooltip label={logLabel} side="top">
      <button
        type="button"
        data-testid="zen-compile-pill"
        aria-pressed={logsOpen}
        onClick={toggleZenCompileLog}
        className={cn(
          PILL,
          "pointer-events-auto text-red-600 transition-colors hover:bg-accent dark:text-red-400",
          logsOpen && "bg-accent",
        )}
      >
        <XCircle className="size-3.5" aria-hidden />
        {t(($) => $.shell.zen.compileFailed)}
      </button>
    </Tooltip>
  );
}

function CompileCornerButton({ revealed }: Readonly<{ revealed: boolean }>) {
  const { t } = useTranslation(["shell"]);
  const [focused, setFocused] = useState(false);
  const status = useCompileStore((state) => state.status);
  const engine = useFilesStore((state) => state.engine);
  const engineLoaded = useFilesStore((state) => state.engineLoaded);
  const blocked = useFilesStore(mainDocumentMissing);
  const hasResult = status === "success" || status === "error";
  const label = hasResult ? t(($) => $.shell.compile.recompile) : t(($) => $.shell.compile.compile);
  const visible = revealed || focused;
  return (
    <Tooltip
      label={
        blocked
          ? t(($) => $.shell.openedFolder.noMain)
          : t(($) => $.shell.compile.runTooltip, {
              action: label,
              engine: engine.label,
              shortcut: shortcut("⌘↵"),
            })
      }
      side="top"
    >
      <Button
        data-testid="zen-compile-button"
        data-visible={visible}
        variant="ghost"
        size="sm"
        aria-label={label}
        disabled={blocked || !engineLoaded}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => void recompileWithPreview()}
        className={cn(
          "pointer-events-auto h-8 gap-1.5 rounded-full bg-primary px-3 text-white shadow-sm transition-opacity hover:bg-primary hover:text-white",
          visible ? "opacity-100" : "opacity-0",
        )}
      >
        {hasResult ? (
          <RefreshCw className="size-3.5" aria-hidden />
        ) : (
          <Play className="size-3.5" aria-hidden />
        )}
        <span className="text-xs font-medium">{label}</span>
      </Button>
    </Tooltip>
  );
}

export function ZenCompileCorner() {
  const near = usePointerNearCorner();
  const compiling = useCompileStore((state) => state.status === "compiling");
  const failed = useCompileFailed();
  return (
    <div
      data-testid="zen-compile-corner"
      className="pointer-events-none fixed bottom-4 right-4 z-30 flex items-center gap-2"
    >
      {compiling ? <CompilingPill /> : null}
      {!compiling && failed ? <FailedPill /> : null}
      {compiling ? null : <CompileCornerButton revealed={near} />}
    </div>
  );
}
