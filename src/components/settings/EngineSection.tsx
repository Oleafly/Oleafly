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
import {
  hasPandoc,
  removeUnusedTinymistDownloads,
  texDistributions,
  type TexDistribution,
  type TypstSource,
  type TypstToolchainStatus,
  type TypstVersionEntry,
} from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { describeError } from "@/lib/app-error";
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
import { formatDate, formatList, formatNumber } from "@/lib/intl";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { SectionHeading } from "@/components/ui/section-heading";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { formatDownloadSize } from "@/lib/download-size";
import {
  TYPST_SETTINGS_TARGET,
  typstInstallBusy,
  typstInstallLabel,
  typstInstallPercent,
  useTypstToolchainStore,
} from "@/store/typst-toolchain";
import { useFilesStore } from "@/store/files";
import { openTypstUpgrade } from "@/components/typst-upgrade/open";
import { newerInstalledTypstVersions, projectTypstVersion } from "@/components/typst-upgrade/versions";

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

type EngineTab = "latex" | "typst" | "markdown";

function releaseDate(releasedAt: string | null): string | null {
  if (!releasedAt) return null;
  const time = Date.parse(releasedAt);
  return Number.isFinite(time) ? formatDate(time, { dateStyle: "medium", timeZone: "UTC" }) : null;
}

function typstSourceLabel(source: TypstSource): string {
  if (source === "bundled") return i18n.t(($) => $.settings.engine.typst.versions.source.bundled);
  if (source === "system") return i18n.t(($) => $.settings.engine.typst.versions.source.system);
  return i18n.t(($) => $.settings.engine.typst.versions.source.downloaded);
}

const ROW_BUTTON =
  "inline-flex shrink-0 items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs hover:bg-accent focus-visible:bg-accent disabled:opacity-50";

function TypstVersionRow({
  entry,
  status,
}: Readonly<{ entry: TypstVersionEntry; status: TypstToolchainStatus }>) {
  const { t } = useTranslation(["common", "settings"]);
  const install = useTypstToolchainStore((s) => s.install);
  const busy = useTypstToolchainStore((s) => s.busy);
  const installVersion = useTypstToolchainStore((s) => s.installVersion);
  const removeVersion = useTypstToolchainStore((s) => s.removeVersion);
  const installed = entry.sources.length > 0;
  const isDefault = entry.version === status.defaultVersion;
  const held = busy || typstInstallBusy(install, status);
  const installing = install?.version === entry.version ? install : null;
  const details = [
    releaseDate(entry.releasedAt) &&
      t(($) => $.settings.engine.typst.versions.released, { date: releaseDate(entry.releasedAt) }),
    entry.downloadBytes ? formatDownloadSize(entry.downloadBytes) : null,
    installed && entry.tinymistVersion
      ? t(($) => $.settings.engine.typst.versions.tinymist, { version: entry.tinymistVersion })
      : null,
  ].filter((part): part is string => Boolean(part));

  const renderAction = () => {
    if (installing) return null;
    if (entry.sources.includes("downloaded")) {
      const removeLabel = t(($) => $.settings.engine.typst.versions.removeAria, { version: entry.version });
      const removeButton = (
        <button
          type="button"
          aria-label={removeLabel}
          aria-disabled={isDefault || undefined}
          disabled={!isDefault && held}
          onClick={() => {
            if (!isDefault) void removeVersion(entry.version);
          }}
          className={cn(ROW_BUTTON, isDefault && "cursor-not-allowed opacity-50 hover:bg-transparent")}
        >
          <Trash2 className="size-3.5" /> {t(($) => $.common.actions.remove)}
        </button>
      );
      return isDefault ? (
        <Tooltip wide side="left" label={t(($) => $.settings.engine.typst.versions.removeDefault)}>
          {removeButton}
        </Tooltip>
      ) : (
        removeButton
      );
    }
    if (installed || !entry.inCatalog) return null;
    return (
      <button
        type="button"
        aria-label={t(($) => $.settings.engine.typst.versions.installAria, { version: entry.version })}
        disabled={held}
        onClick={() => void installVersion(entry.version)}
        className={ROW_BUTTON}
      >
        <Download className="size-3.5" /> {t(($) => $.settings.engine.typst.versions.install)}
      </button>
    );
  };

  return (
    <div
      data-testid={`typst-version-row-${entry.version}`}
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-3 py-2.5 last:border-b-0"
    >
      <span className="flex w-4 shrink-0 justify-center">
        {installed && (
          <RadioGroupItem
            value={entry.version}
            aria-label={t(($) => $.settings.engine.typst.versions.setDefault, { version: entry.version })}
          />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-sm">{entry.version}</span>
          {isDefault && (
            <Badge variant="primaryGhost" size="sm">
              {t(($) => $.settings.engine.typst.versions.default)}
            </Badge>
          )}
          {entry.sources.map((source) => (
            <Badge key={source} variant={source === "downloaded" ? "success" : "muted"} size="sm">
              {typstSourceLabel(source)}
            </Badge>
          ))}
        </div>
        {details.length > 0 && (
          <p className="truncate text-[11px] text-muted-foreground">{details.join(" · ")}</p>
        )}
        {installing && (
          <div className="mt-1.5 flex items-center gap-2">
            <Progress
              value={typstInstallPercent(installing) ?? 0}
              className="max-w-48"
              indicatorClassName="bg-primary"
            />
            <span className="shrink-0 text-[11px] text-muted-foreground">{typstInstallLabel(installing)}</span>
          </div>
        )}
      </div>
      {renderAction()}
    </div>
  );
}

function TypstVersionList() {
  const { t } = useTranslation(["common", "settings"]);
  const status = useTypstToolchainStore((s) => s.status);
  const loadFailed = useTypstToolchainStore((s) => s.loadFailed);
  const busy = useTypstToolchainStore((s) => s.busy);
  const refresh = useTypstToolchainStore((s) => s.refresh);
  const setDefaultVersion = useTypstToolchainStore((s) => s.setDefaultVersion);

  if (!status) {
    if (!loadFailed) {
      return (
        <p className="text-xs text-muted-foreground">
          {t(($) => $.settings.engine.typst.versions.loading)}
        </p>
      );
    }
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground">{t(($) => $.settings.engine.typst.error.load)}</p>
        <button type="button" onClick={() => void refresh()} className={ROW_BUTTON}>
          {t(($) => $.common.actions.retry)}
        </button>
      </div>
    );
  }

  return (
    <RadioGroup
      value={status.defaultChoice ?? status.bundledVersion}
      onValueChange={(value) => {
        void setDefaultVersion(value === status.bundledVersion ? null : value);
      }}
      disabled={busy}
      aria-label={t(($) => $.settings.engine.typst.versions.heading)}
      className="gap-0 overflow-hidden rounded-lg border"
    >
      {status.versions.map((entry) => (
        <TypstVersionRow key={entry.version} entry={entry} status={status} />
      ))}
    </RadioGroup>
  );
}

const TINYMIST_CLEANUP_TOAST = "typst-tinymist-cleanup";
const NO_DOWNLOADS: readonly string[] = [];

function TinymistCleanup() {
  const { t } = useTranslation(["settings"]);
  const unused = useTypstToolchainStore((s) => s.status?.unusedTinymist ?? NO_DOWNLOADS);
  const [removing, setRemoving] = useState(false);
  if (unused.length === 0) return null;

  const remove = async () => {
    setRemoving(true);
    try {
      const status = await removeUnusedTinymistDownloads();
      useTypstToolchainStore.setState({ status, loading: false, loadFailed: false });
      toast.successUnique(
        TINYMIST_CLEANUP_TOAST,
        t(($) => $.settings.engine.typst.languageServer.removed, { count: unused.length }),
      );
    } catch (error) {
      toast.errorUnique(
        TINYMIST_CLEANUP_TOAST,
        t(($) => $.settings.engine.packages.error.withDetail, {
          message: t(($) => $.settings.engine.typst.error.removeTinymist),
          detail: describeError(error),
        }),
      );
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div
      data-testid="typst-tinymist-cleanup"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-3 py-2.5"
    >
      <p className="min-w-0 flex-1 text-[11px] text-muted-foreground">
        {t(($) => $.settings.engine.typst.languageServer.unused, { count: unused.length })}
      </p>
      <button type="button" disabled={removing} onClick={() => void remove()} className={ROW_BUTTON}>
        <Trash2 className="size-3.5" /> {t(($) => $.settings.engine.typst.languageServer.remove)}
      </button>
    </div>
  );
}

function TypstUpgradeEntry() {
  const { t } = useTranslation(["settings"]);
  const projectId = useFilesStore((s) => s.projectId);
  const engine = useFilesStore((s) => s.engine);
  const status = useTypstToolchainStore((s) => s.status);
  if (!projectId || engine.source_format !== "typst") return null;
  const newer = newerInstalledTypstVersions(status, projectTypstVersion(engine, status))[0];
  if (!newer) return null;
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3" data-testid="typst-upgrade-entry">
      <div className="min-w-0 flex-1">
        <p className="text-sm">{t(($) => $.settings.engine.typst.upgrade.heading)}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">{t(($) => $.settings.engine.typst.upgrade.detail)}</p>
      </div>
      <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => openTypstUpgrade(newer)}>
        {t(($) => $.settings.engine.typst.upgrade.check, { version: newer })}
      </Button>
    </div>
  );
}

function TypstEngineTab() {
  const { t } = useTranslation(["common", "settings"]);
  const status = useTypstToolchainStore((s) => s.status);
  const refresh = useTypstToolchainStore((s) => s.refresh);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const bundledIsDefault = status !== null && status.defaultVersion === status.bundledVersion;

  return (
    <>
      <div className="flex items-center gap-1.5">
        <SectionHeading>
          {t(($) => $.settings.engine.typst.heading)}
        </SectionHeading>
        <Tooltip wide side="right" label={t(($) => $.settings.engine.typst.tooltip)}>
          <Info className="size-3.5 cursor-help text-muted-foreground/60 hover:text-muted-foreground" />
        </Tooltip>
      </div>
      <div
        className={cn("rounded-lg border p-3", bundledIsDefault && "border-primary")}
        data-testid="typst-engine-bundled"
      >
        <div className="flex items-center gap-2">
          <Cpu className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-sm">{t(($) => $.settings.engine.typst.name)}</span>
          {bundledIsDefault && <Check className="size-3.5 text-primary" />}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t(($) => $.settings.engine.typst.detail)}
        </p>
        {status && (
          <p className="mt-1 font-mono text-[10px] text-muted-foreground/70">{`Typst ${status.bundledVersion}`}</p>
        )}
      </div>
      {status?.system && (
        <div className="rounded-lg border p-3" data-testid="typst-engine-system">
          <div className="flex items-center gap-2">
            <HardDrive className="size-4 shrink-0 text-muted-foreground" />
            <span className="text-sm">{t(($) => $.settings.engine.typst.system.name)}</span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t(($) => $.settings.engine.typst.system.detail, { version: status.system.version })}
          </p>
          <p className="mt-1 font-mono text-[10px] text-muted-foreground/70">{`Typst ${status.system.version}`}</p>
          <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground/70">
            <SettingsPath path={status.system.path} />
          </p>
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <SectionHeading>
          {t(($) => $.settings.engine.typst.versions.heading)}
        </SectionHeading>
        <Tooltip wide side="right" label={t(($) => $.settings.engine.typst.versions.tooltip)}>
          <Info className="size-3.5 cursor-help text-muted-foreground/60 hover:text-muted-foreground" />
        </Tooltip>
      </div>
      <TypstVersionList />
      <TypstUpgradeEntry />
      <TinymistCleanup />
      <p className="text-xs text-muted-foreground">
        {t(($) => $.settings.engine.typst.note)}
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
  const scrollTarget = useSettingsStore((s) => s.settingsScrollTarget);
  const setScrollTarget = useSettingsStore((s) => s.setSettingsScrollTarget);
  const [tab, setTab] = useState<EngineTab>(() =>
    scrollTarget === TYPST_SETTINGS_TARGET ? "typst" : "latex",
  );
  useEffect(() => {
    if (scrollTarget !== TYPST_SETTINGS_TARGET) return;
    setTab("typst");
    setScrollTarget(null);
  }, [scrollTarget, setScrollTarget]);

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
      onValueChange={(value) => setTab(value as EngineTab)}
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
        <TypstEngineTab />
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
