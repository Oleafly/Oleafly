import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, Cpu, Download, HardDrive, Info, Trash2 } from "lucide-react";
import { installPhaseLabel, useEngineStore } from "@/store/engine";
import {
  sectionDiffersFromDefaults,
  useSettingsStore,
  type DefaultLatexEngine,
} from "@/store/settings";
import { TexPackagesSection } from "./TexPackagesSection";
import { hasPandoc, texDistributions, type TexDistribution } from "@/lib/tauri";
import { useDisplayPath } from "@/lib/display-path";
import { SettingsPath } from "@/components/settings/SettingsPath";
import { ensurePandoc } from "@/features/pandoc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isTauri } from "@tauri-apps/api/core";
import { Tooltip } from "@/components/ui/tooltip";
import { ResetToDefaults } from "@/components/settings/ResetToDefaults";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { i18n } from "@/i18n";
import { formatList, formatNumber } from "@/lib/intl";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { SectionHeading } from "@/components/ui/section-heading";

// Kept in step with scripts/fetch-typst.sh, which pins the bundled sidecar.
const BUNDLED_TYPST_VERSION = "0.15.1";

const ENGINE_CHOICES: DefaultLatexEngine[] = ["tectonic", "latexmk"];

// Plain-sentence summary of what a detected distribution ships and where
// Oleafly runs it from, for the info icon on each row.
function distroTooltip(distro: TexDistribution, binDir: string): string {
  const tools = [distro.latexmk && "latexmk", distro.tlmgr && "tlmgr"].filter(
    (tool): tool is string => typeof tool === "string",
  );
  return tools.length > 0
    ? i18n.t(($) => $.settings.engine.distributions.rowTooltip, {
        tools: formatList(tools),
        binDir,
      })
    : i18n.t(($) => $.settings.engine.distributions.rowTooltipNoTools, { binDir });
}

/**
 * Markdown projects compile through the bundled Pandoc into LaTeX and then
 * the bundled Tectonic. The install action is a recovery path for development
 * builds or damaged app bundles.
 */
function MarkdownEngineTab() {
  const { t } = useTranslation(["common", "settings"]);
  const [pandoc, setPandoc] = useState<"checking" | "ready" | "missing" | "installing">("checking");
  const refresh = useCallback(async () => {
    try {
      setPandoc((await hasPandoc()) ? "ready" : "missing");
    } catch {
      setPandoc("missing");
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const install = async () => {
    setPandoc("installing");
    const ok = await ensurePandoc({ notify: true });
    setPandoc(ok ? "ready" : "missing");
  };
  return (
    <>
      <div className="flex items-center gap-1.5">
        <SectionHeading>
          {t(($) => $.settings.engine.markdown.heading)}
        </SectionHeading>
        <Tooltip
          wide
          side="right"
          label={t(($) => $.settings.engine.markdown.tooltip)}
        >
          <Info className="size-3.5 cursor-help text-muted-foreground/60 hover:text-muted-foreground" />
        </Tooltip>
      </div>
      <div
        className={cn(
          "rounded-lg border p-3",
          pandoc === "ready" && "border-primary",
        )}
        data-testid="markdown-engine-pandoc"
      >
        <div className="flex items-center gap-2">
          <Cpu className="size-4 text-muted-foreground" />
          <span className="text-sm">{"pandoc"}</span>
          {pandoc === "ready" && <Check className="size-3.5 text-primary" />}
          {pandoc === "missing" && (
            <Button type="button" size="sm" variant="outline" className="ml-auto h-7" onClick={() => void install()}>
              {t(($) => $.settings.engine.markdown.repair)}
            </Button>
          )}
          {pandoc === "installing" && (
            <span className="ml-auto text-xs text-muted-foreground">
              {t(($) => $.settings.engine.markdown.downloading)}
            </span>
          )}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {pandoc === "checking" && t(($) => $.settings.engine.markdown.status.checking)}
          {pandoc === "ready" && t(($) => $.settings.engine.markdown.status.ready)}
          {pandoc === "missing" && t(($) => $.settings.engine.markdown.status.missing)}
          {pandoc === "installing" && t(($) => $.settings.engine.markdown.status.installing)}
        </p>
      </div>
      <div className="rounded-lg border border-primary p-3">
        <div className="flex items-center gap-2">
          <Cpu className="size-4 text-muted-foreground" />
          <span className="text-sm">{t(($) => $.settings.engine.choices.tectonic.name)}</span>
          <Check className="size-3.5 text-primary" />
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t(($) => $.settings.engine.markdown.tectonicDetail)}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        {t(($) => $.settings.engine.markdown.note)}
      </p>
    </>
  );
}

export function EngineSection() {
  const { t } = useTranslation(["common", "settings"]);
  const displayPath = useDisplayPath();
  const { info, installing, progress, refresh, refreshPackages, install, remove } =
    useEngineStore();
  const defaultLatexEngine = useSettingsStore((s) => s.defaultLatexEngine);
  const setDefaultLatexEngine = useSettingsStore((s) => s.setDefaultLatexEngine);
  const resetEnginePreferences = useSettingsStore((s) => s.resetEnginePreferences);
  const engineChanged = useSettingsStore((s) => sectionDiffersFromDefaults("engine", s));
  const installPhase = useEngineStore((s) => s.installPhase);
  const partialDownloadBytes = useEngineStore((s) => s.partialDownloadBytes);
  const [distros, setDistros] = useState<TexDistribution[]>([]);
  const [tab, setTab] = useState<"latex" | "typst" | "markdown">("latex");

  useEffect(() => {
    // refreshPackages() needs engine info from refresh() first, so run in sequence.
    void refresh().then(() => refreshPackages());
  }, [refresh, refreshPackages]);

  // Reload the distribution list whenever an install or removal lands, so the
  // freshly installed TinyTeX row replaces the download card immediately (and
  // returns after a removal).
  // biome-ignore lint/correctness/useExhaustiveDependencies: info triggers a reload after remove()
  useEffect(() => {
    if (installing || !isTauri()) return;
    void texDistributions().then(setDistros).catch(() => {});
  }, [installing, info]);

  const kind = info?.kind ?? "none";

  const tinytexActionLabel = () => {
    if (installing) return installPhaseLabel(installPhase, progress);
    if (partialDownloadBytes > 0) {
      return t(($) => $.settings.engine.tinytex.resume, {
        size: formatNumber(Math.round(partialDownloadBytes / 1_000_000)),
      });
    }
    return t(($) => $.settings.engine.tinytex.download);
  };

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(value as "latex" | "typst" | "markdown")}
      className="flex flex-col gap-5"
    >
      <TabsList aria-label={t(($) => $.settings.engine.sectionName)} className="w-fit self-start">
        <TabsTrigger value="latex" data-testid="engines-tab-latex">LaTeX</TabsTrigger>
        <TabsTrigger value="typst" data-testid="engines-tab-typst">Typst</TabsTrigger>
        <TabsTrigger value="markdown" data-testid="engines-tab-markdown">Markdown</TabsTrigger>
      </TabsList>

      <TabsContent value="markdown" className="flex flex-col gap-5">
        <MarkdownEngineTab />
      </TabsContent>

      <TabsContent value="typst" className="flex flex-col gap-5">
          <div className="flex items-center gap-1.5">
            <SectionHeading>
              {t(($) => $.settings.engine.typst.heading)}
            </SectionHeading>
            <Tooltip
              wide
              side="right"
              label={t(($) => $.settings.engine.typst.tooltip)}
            >
              <Info className="size-3.5 cursor-help text-muted-foreground/60 hover:text-muted-foreground" />
            </Tooltip>
          </div>
          <div className="rounded-lg border border-primary p-3">
            <div className="flex items-center gap-2">
              <Cpu className="size-4 text-muted-foreground" />
              <span className="text-sm">{t(($) => $.settings.engine.typst.name)}</span>
              <Check className="size-3.5 text-primary" />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t(($) => $.settings.engine.typst.detail)}
            </p>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground/70">{`Typst ${BUNDLED_TYPST_VERSION}`}</p>
          </div>
          <p className="text-xs text-muted-foreground">
            {t(($) => $.settings.engine.typst.note)}
          </p>
      </TabsContent>

      <TabsContent value="latex" className="flex flex-col gap-5">
      <div className="flex items-center gap-1.5">
        <SectionHeading>
          {t(($) => $.settings.engine.defaultEngine.heading)}
        </SectionHeading>
        <Tooltip
          wide
          side="right"
          label={t(($) => $.settings.engine.defaultEngine.tooltip)}
        >
          <Info className="size-3.5 cursor-help text-muted-foreground/60 hover:text-muted-foreground" />
        </Tooltip>
      </div>

      <div className="flex flex-col gap-2">
        {ENGINE_CHOICES.map((choiceId) => {
          const selected = defaultLatexEngine === choiceId;
          const missing = choiceId === "latexmk" && !info?.latexmk;
          return (
            <button
              key={choiceId}
              type="button"
              onClick={() => setDefaultLatexEngine(choiceId)}
              className={cn(
                "rounded-lg border p-3 text-left transition-colors hover:bg-accent/50",
                selected && "border-primary",
              )}
            >
              <div className="flex items-center gap-2">
                <Cpu className="size-4 text-muted-foreground" />
                <span className="text-sm">{t(($) => $.settings.engine.choices[choiceId].name)}</span>
                {selected && <Check className="size-3.5 text-primary" />}
                {missing && (
                  <Badge variant="warning" size="sm" className="ml-auto gap-1">
                    <AlertTriangle className="size-2.5" /> {t(($) => $.settings.engine.latexmkMissing)}
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t(($) => $.settings.engine.choices[choiceId].detail)}
              </p>
              {choiceId === "latexmk" && info?.latexmk && (
                <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground/70"><SettingsPath focusable={false} path={info.latexmk} /></p>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-1.5">
        <SectionHeading>
          {t(($) => $.settings.engine.distributions.heading)}
        </SectionHeading>
        <Tooltip
          wide
          side="right"
          label={t(($) => $.settings.engine.distributions.tooltip)}
        >
          <Info className="size-3.5 cursor-help text-muted-foreground/60 hover:text-muted-foreground" />
        </Tooltip>
      </div>

      <div className="flex flex-col gap-2">
        {distros.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {t(($) => $.settings.engine.distributions.empty)}
          </p>
        )}
        {distros.map((distro) => (
          <div key={distro.bin_dir} className="rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <HardDrive className="size-4 shrink-0 text-muted-foreground" />
              <span className="text-sm">{distro.label}</span>
              <Tooltip wide side="right" label={distroTooltip(distro, displayPath(distro.bin_dir))}>
                <Info className="size-3.5 shrink-0 cursor-help text-muted-foreground/60 hover:text-muted-foreground" />
              </Tooltip>
              {distro.latexmk && (
                <Badge variant="success" size="sm">
                  {"latexmk"}
                </Badge>
              )}
              {distro.tlmgr && (
                <Badge variant="muted" size="sm">
                  {"tlmgr"}
                </Badge>
              )}
              {distro.kind === "oleafly-tinytex" && (
                <button
                  type="button"
                  onClick={() => void remove()}
                  className="ml-auto inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 text-[11px] hover:bg-accent"
                >
                  <Trash2 className="size-3" /> {t(($) => $.common.actions.remove)}
                </button>
              )}
            </div>
            <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground/70"><SettingsPath path={distro.bin_dir} /></p>
          </div>
        ))}
        {!distros.some((d) => d.kind === "oleafly-tinytex") && (
          <div className="rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <Download className="size-4 shrink-0 text-muted-foreground" />
              <span className="text-sm">{"TinyTeX"}</span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {t(($) => $.settings.engine.tinytex.detail)}
            </p>
            <div className="mt-2">
              <button
                type="button"
                onClick={() => void install()}
                disabled={installing}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs text-white hover:opacity-90 disabled:opacity-60"
              >
                {installing ? <Spinner size="sm" /> : <Download className="size-3.5" />}
                {tinytexActionLabel()}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <SectionHeading>
          {t(($) => $.settings.engine.tagging.heading)}
        </SectionHeading>
        <Tooltip
          wide
          side="right"
          label={t(($) => $.settings.engine.tagging.tooltip)}
        >
          <Info className="size-3.5 cursor-help text-muted-foreground/60 hover:text-muted-foreground" />
        </Tooltip>
      </div>

      <div className="rounded-lg border p-3">
        <div className="flex items-center gap-2">
          <Cpu className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-sm">{t(($) => $.settings.engine.tagging.status[kind])}</span>
        </div>
        {info?.version && (
          <p className="mt-1 truncate pl-6 font-mono text-[11px] text-muted-foreground">
            {info.version}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t(($) => $.settings.engine.tagging.hint[kind])}
          </span>
        </div>
      </div>

      <TexPackagesSection />
      </TabsContent>
      <ResetToDefaults
        sectionName={t(($) => $.settings.engine.sectionName)}
        onReset={resetEnginePreferences}
        changed={engineChanged}
      />
    </Tabs>
  );
}
