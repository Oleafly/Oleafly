import { useEffect, useId, useState } from "react";
import { Check, Cpu, Download, Loader2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useModalAccessibility } from "@/components/ui/use-modal-accessibility";
import {
  dismissEngineHint,
  useEnginePickerStore,
} from "@/store/engine-picker";
import { useEngineStore } from "@/store/engine";
import { useFilesStore } from "@/store/files";
import { latexmkFixesFinding, type ImportCompatFinding } from "@oleafly/latex";
import { notifyError, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const LEVEL_DOT: Record<ImportCompatFinding["level"], string> = {
  blocker: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-muted-foreground/50",
};

/**
 * The three-way engine choice for projects that need tools beyond Tectonic
 * (minted, glossaries/makeindex, pythontex, shell-escape-heavy templates).
 * Opened from the import-scan toast, from a compile failure that matches a
 * known Tectonic gap, and from the compile options menu.
 */
export function EnginePickerModal() {
  const open = useEnginePickerStore((s) => s.open);
  const source = useEnginePickerStore((s) => s.source);
  const findings = useEnginePickerStore((s) => s.findings);
  const close = useEnginePickerStore((s) => s.close);

  const projectId = useFilesStore((s) => s.projectId);
  const engineId = useFilesStore((s) => s.engine.id);
  const setEngine = useFilesStore((s) => s.setEngine);

  const info = useEngineStore((s) => s.info);
  const installing = useEngineStore((s) => s.installing);
  const progress = useEngineStore((s) => s.progress);
  const ensureLoaded = useEngineStore((s) => s.ensureLoaded);
  const install = useEngineStore((s) => s.install);

  const [switching, setSwitching] = useState(false);
  const titleId = useId();
  const { dialogRef, onBackdropMouseDown } = useModalAccessibility<HTMLDivElement>(
    open,
    close,
  );

  useEffect(() => {
    if (open) void ensureLoaded();
  }, [open, ensureLoaded]);

  if (!open) return null;

  const hasSystemTex = !!info?.latexmk;
  const alreadyLatexmk = engineId === "latexmk";
  const fixable = findings.filter((finding) => latexmkFixesFinding(finding.id));

  const pinLatexmk = async (afterInstall: boolean) => {
    setSwitching(true);
    try {
      await setEngine("latexmk");
      toast.success(
        afterInstall
          ? "TinyTeX installed. This project now compiles with latexmk."
          : "This project now compiles with latexmk.",
      );
      close();
      if (source === "compile-failure") {
        const compile = await import("@/store/compile");
        void compile.useCompileStore.getState().recompile();
      }
    } catch (error) {
      notifyError("switch compile engine", error);
    } finally {
      setSwitching(false);
    }
  };

  const installThenPin = async () => {
    await install();
    // install() surfaces its own failure toast; only pin when latexmk exists.
    if (useEngineStore.getState().info?.latexmk) {
      await pinLatexmk(true);
    }
  };

  const keepTectonic = () => {
    if (projectId) dismissEngineHint(projectId, findings);
    close();
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0"
        onMouseDown={onBackdropMouseDown}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative flex w-full max-w-lg flex-col gap-4 rounded-xl border bg-background p-5 shadow-2xl"
      >
        <div>
          <h2 id={titleId} className="text-sm font-semibold">
            {source === "compile-failure"
              ? "This compile needs more than the built-in engine"
              : "This project needs more than the built-in engine"}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {source === "compile-failure"
              ? "The failure matches a known gap in the bundled Tectonic engine. Pick how this project should compile — the choice is saved in the project, so collaborators get the same setup."
              : "The import scan found features the bundled Tectonic engine does not orchestrate. Pick how this project should compile — the choice is saved in the project, so collaborators get the same setup."}
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
          <div
            className={cn(
              "rounded-lg border p-3",
              hasSystemTex && "border-primary/60",
            )}
          >
            <div className="flex items-center gap-2">
              <Cpu className="size-4 shrink-0 text-muted-foreground" />
              <span className="text-sm font-medium">Use my system LaTeX (latexmk)</span>
              {hasSystemTex && (
                <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  Recommended
                </span>
              )}
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {hasSystemTex
                ? "A TeX distribution was found on this machine. latexmk orchestrates every pass — Biber, makeindex, shell-escape — exactly like Overleaf."
                : "No TeX distribution (MacTeX, TeX Live, MiKTeX, TinyTeX) was found on this machine."}
            </p>
            {info?.latexmk && (
              <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground/70">
                {info.latexmk}
              </p>
            )}
            <div className="mt-2">
              <Button
                size="sm"
                disabled={!hasSystemTex || switching || alreadyLatexmk}
                onClick={() => void pinLatexmk(false)}
                data-modal-initial-focus={hasSystemTex || undefined}
              >
                {switching ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : alreadyLatexmk ? (
                  <Check className="size-3.5" />
                ) : null}
                {alreadyLatexmk ? "Already selected" : "Use system LaTeX"}
              </Button>
            </div>
          </div>

          {/* Option 2: on-demand TinyTeX (hidden when a system TeX already covers it) */}
          {!hasSystemTex && (
            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Download className="size-4 shrink-0 text-muted-foreground" />
                <span className="text-sm font-medium">Download TinyTeX</span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Installs a minimal TeX Live into your home folder — no admin rights.
                The core download is about 100 MB; journal templates can pull more
                packages later, up to roughly 1 GB in total.
              </p>
              <div className="mt-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={installing || switching}
                  onClick={() => void installThenPin()}
                >
                  {installing ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  {installing
                    ? progress != null
                      ? `Downloading… ${progress}%`
                      : "Downloading…"
                    : "Download and use TinyTeX"}
                </Button>
              </div>
            </div>
          )}

          {/* Option 3: stay on Tectonic */}
          <div className="rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <Zap className="size-4 shrink-0 text-muted-foreground" />
              <span className="text-sm font-medium">Keep using Tectonic</span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {fixable.length > 0
                ? `Zero setup, works offline. ${fixable.map((f) => f.title).join("; ")} ${fixable.length === 1 ? "is" : "are"} expected to keep failing.`
                : "Zero setup, works offline. Fine for plain LaTeX and most common packages."}
            </p>
            <div className="mt-2">
              <Button size="sm" variant="ghost" onClick={keepTectonic}>
                Keep Tectonic
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
