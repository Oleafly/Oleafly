import { useEffect, useState } from "react";
import { AlertTriangle, Check, Copy, FileCheck2, Info, Pencil, Plus, Wand2 } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { prepareAccessibleSource, type PrepChange, type PrepResult } from "@openleaf/preflight";
import { useFilesStore } from "@/store/files";
import { usePreflightStore } from "@/store/preflight";
import { useEngineStore } from "@/store/engine";
import { compileTaggedAndVerify } from "@/features/latex-engine";
import { pathUsesEngineSource } from "@/lib/document-engine";
import { objectKey } from "@/lib/react-key";
import { canPrepareAccessible } from "./prep-capability";

const KIND: Record<PrepChange["kind"], { icon: typeof Info; color: string }> = {
  add: { icon: Plus, color: "text-emerald-500" },
  modify: { icon: Pencil, color: "text-blue-500" },
  warn: { icon: AlertTriangle, color: "text-amber-500" },
  info: { icon: Info, color: "text-muted-foreground" },
};

// Tier C: OpenLeaf prepares the source for a tagging engine (LuaLaTeX + TeX
// Live 2025) to compile into tagged, accessible output; Preflight verifies it.
export function PrepExport() {
  const [result, setResult] = useState<PrepResult | null>(null);
  const [applied, setApplied] = useState(false);
  const [copied, setCopied] = useState(false);

  const activePath = useFilesStore((s) => s.activePath);
  const source = useFilesStore((s) => (s.activePath ? s.files[s.activePath]?.content ?? "" : ""));
  const latexSource = useFilesStore((s) =>
    canPrepareAccessible(s.engineLoaded, s.engine.capabilities.source_preflight_profile) &&
    pathUsesEngineSource(s.engine, s.activePath),
  );

  const engine = useEngineStore((s) => s.info);
  const ensureEngine = useEngineStore((s) => s.ensureLoaded);
  const hasEngine = !!engine && engine.kind !== "none";

  useEffect(() => {
    if (isTauri()) void ensureEngine();
  }, [ensureEngine]);

  const run = () => {
    if (!latexSource) return;
    setResult(prepareAccessibleSource(source));
    setApplied(false);
    setCopied(false);
  };

  const apply = () => {
    if (!latexSource || !result || !activePath) return;
    useFilesStore.getState().setContent(activePath, result.output);
    setApplied(true);
    void usePreflightStore.getState().run();
  };

  const copy = () => {
    if (!result) return;
    void navigator.clipboard.writeText(result.output).then(() => setCopied(true));
  };

  if (!latexSource) return null;
  return (
    <div className="mx-3 mb-4 rounded-md border border-sidebar-border bg-black/[0.03] dark:bg-background">
      <div className="px-2.5 py-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Accessible export</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          Prepare this document for a tagged, Section 508 / PDF-UA export. OpenLeaf adds the required setup. Compile the
          result with LuaLaTeX (TeX Live 2025 or newer), then re-check.
        </p>
        <button type="button"
          onClick={run}
          disabled={!activePath}
          className="mt-2 inline-flex items-center gap-1.5 rounded border border-input px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
        >
          <Wand2 className="size-3.5" /> Prepare for accessible export
        </button>
      </div>

      {result && (
        <div className="border-t border-sidebar-border px-2.5 py-2">
          <ul className="flex flex-col gap-1.5">
            {result.changes.map((c) => {
              const { icon: Icon, color } = KIND[c.kind];
              return (
                <li key={objectKey(c, "prep-change")} className="flex items-start gap-2 text-[11px] leading-relaxed">
                  <Icon className={`mt-0.5 size-3.5 shrink-0 ${color}`} />
                  <span className="text-muted-foreground">{c.summary}</span>
                </li>
              );
            })}
          </ul>
          <div className="mt-2.5 flex gap-1.5">
            <button type="button"
              onClick={apply}
              disabled={applied}
              className="inline-flex items-center gap-1.5 rounded bg-primary px-2 py-1 text-xs text-white hover:opacity-90 disabled:opacity-60"
            >
              {applied ? <Check className="size-3" /> : null}
              {applied ? "Applied" : "Apply to document"}
            </button>
            <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded border border-input px-2 py-1 text-xs hover:bg-accent">
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              {copied ? "Copied" : "Copy source"}
            </button>
          </div>

          <div className="mt-2.5 border-t border-sidebar-border pt-2.5">
            {hasEngine ? (
              <button type="button"
                onClick={() => void compileTaggedAndVerify()}
                className="inline-flex items-center gap-1.5 rounded border border-input px-2 py-1 text-xs hover:bg-accent"
              >
                <FileCheck2 className="size-3.5" /> Compile tagged and verify
              </button>
            ) : (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                To produce the tagged PDF in the app, enable an engine in Settings, LaTeX Engine. Or compile the prepared
                source with your own LuaLaTeX (TeX Live 2025 or newer).
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
