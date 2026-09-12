import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, Copy, FileCheck2, Info, Pencil, Plus, Wand2 } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { prepareAccessibleSource, type PrepChange, type PrepResult } from "@oleafly/preflight";
import { useFilesStore } from "@/store/files";
import { usePreflightStore } from "@/store/preflight";
import { useEngineStore } from "@/store/engine";
import { compileTaggedAndVerify } from "@/features/latex-engine";
import { pathUsesEngineSource } from "@/lib/document-engine";
import { resolveEffectiveMainDoc } from "@/lib/tex-root";
import { objectKey } from "@/lib/react-key";
import { canPrepareAccessible, gateDocument, prepGate } from "./prep-capability";
import { renderMessage, type PreflightTranslate } from "./message";

const KIND: Record<PrepChange["kind"], { icon: typeof Info; color: string }> = {
  add: { icon: Plus, color: "text-emerald-500" },
  modify: { icon: Pencil, color: "text-blue-500" },
  warn: { icon: AlertTriangle, color: "text-amber-500" },
  info: { icon: Info, color: "text-muted-foreground" },
};

export function PrepExport() {
  const { t } = useTranslation(["common", "preflight"]);
  const tp = t as unknown as PreflightTranslate;
  const [result, setResult] = useState<PrepResult | null>(null);
  const [applied, setApplied] = useState(false);
  const [copied, setCopied] = useState(false);

  const activePath = useFilesStore((s) => s.activePath);
  const source = useFilesStore((s) => (s.activePath ? s.files[s.activePath]?.content ?? "" : ""));
  const projectFiles = useFilesStore((s) => s.files);
  const mainDocPath = useFilesStore(() => resolveEffectiveMainDoc().mainDoc);
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

  const gated = useMemo(
    () => gateDocument(mainDocPath, projectFiles, source),
    [mainDocPath, projectFiles, source],
  );
  const gate = useMemo(() => (latexSource ? prepGate(gated.source) : null), [latexSource, gated]);

  const run = () => {
    if (!latexSource || !gate?.offer) return;
    setResult(prepareAccessibleSource(source, { engine: hasEngine ? "lualatex" : "bundled" }));
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
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t(($) => $.preflight.prepExport.title)}
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          {t(($) => $.preflight.prepExport.intro)}
        </p>
        {gate && gated.origin === "active" && (
          <p className="mt-2 flex items-start gap-1 text-[11px] leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
            <span>{t(($) => $.preflight.prepExport.activeFileFallback)}</span>
          </p>
        )}
        {gate?.classNotice && (
          <p className="mt-2 flex items-start gap-1 text-[11px] leading-relaxed text-muted-foreground">
            <AlertTriangle
              className={`mt-0.5 size-3 shrink-0 ${gate.classSeverity === "block" ? "text-red-500" : "text-amber-600 dark:text-amber-500"}`}
            />
            <span>{renderMessage(tp, gate.classNotice)}</span>
          </p>
        )}
        {gate?.packageNotice && (
          <p className="mt-1.5 flex items-start gap-1 text-[11px] leading-relaxed text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-600 dark:text-amber-500" />
            <span>{renderMessage(tp, gate.packageNotice)}</span>
          </p>
        )}
        {gate && gate.cautionNotices.length > 0 && (
          <p className="mt-1.5 flex items-start gap-1 text-[11px] leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
            <span>{gate.cautionNotices.map((notice) => renderMessage(tp, notice)).join(" ")}</span>
          </p>
        )}
        {gate?.offer ? (
          <button type="button"
            onClick={run}
            disabled={!activePath}
            className="mt-2 inline-flex items-center gap-1.5 rounded border border-input px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
          >
            <Wand2 className="size-3.5" /> {t(($) => $.preflight.prepExport.prepare)}
          </button>
        ) : (
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            {gate?.retrieved
              ? t(($) => $.preflight.prepExport.unavailable, { retrieved: gate.retrieved })
              : t(($) => $.preflight.prepExport.unavailableUndated)}
          </p>
        )}
      </div>

      {result && (
        <div className="border-t border-sidebar-border px-2.5 py-2">
          <ul className="flex flex-col gap-1.5">
            {result.changes.map((c) => {
              const { icon: Icon, color } = KIND[c.kind];
              return (
                <li key={objectKey(c, "prep-change")} className="flex items-start gap-2 text-[11px] leading-relaxed">
                  <Icon className={`mt-0.5 size-3.5 shrink-0 ${color}`} />
                  <span className="text-muted-foreground">{renderMessage(tp, c.summary)}</span>
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
              {applied ? t(($) => $.preflight.prepExport.applied) : t(($) => $.preflight.prepExport.apply)}
            </button>
            <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded border border-input px-2 py-1 text-xs hover:bg-accent">
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              {copied ? t(($) => $.preflight.prepExport.copied) : t(($) => $.preflight.prepExport.copy)}
            </button>
          </div>

          <div className="mt-2.5 border-t border-sidebar-border pt-2.5">
            {hasEngine ? (
              <div className="space-y-1.5">
                <button type="button"
                  onClick={() => void compileTaggedAndVerify()}
                  className="inline-flex items-center gap-1.5 rounded border border-input px-2 py-1 text-xs hover:bg-accent"
                >
                  <FileCheck2 className="size-3.5" /> {t(($) => $.preflight.prepExport.compileTagged)}
                </button>
                <p className="flex items-start gap-1 text-[11px] leading-relaxed text-muted-foreground">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-600 dark:text-amber-500" />
                  {t(($) => $.preflight.prepExport.compileTaggedWarning)}
                </p>
              </div>
            ) : (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {t(($) => $.preflight.prepExport.noEngine)}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
