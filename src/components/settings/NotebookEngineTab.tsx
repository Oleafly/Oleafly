import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Info } from "lucide-react";
import { Cpu, Download, HardDrive, Trash2 } from "@/components/icons/pack";
import type {
  LanguageRuntime,
  LanguageRuntimeName,
  NotebookTool,
  NotebookToolInstall,
  NotebookToolStatus,
} from "@/lib/notebook-commands";
import { formatDownloadSize } from "@/lib/download-size";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckBadge } from "@/components/ui/check-badge";
import { Progress } from "@/components/ui/progress";
import { SectionHeading } from "@/components/ui/section-heading";
import { Tooltip } from "@/components/ui/tooltip";
import { SettingsPath } from "@/components/settings/SettingsPath";
import {
  NOTEBOOK_TOOL_LABELS,
  notebookInstallLabel,
  notebookInstallPercent,
  notebookToolBusy,
  useNotebookToolchainStore,
} from "@/store/notebook-toolchain";

const RUNTIME_LABELS: Readonly<Record<LanguageRuntimeName, string>> = {
  r: "R",
  python: "Python",
  julia: "Julia",
};

const RUNTIME_ORDER: readonly LanguageRuntimeName[] = ["r", "python", "julia"];

function InfoTip({ label }: Readonly<{ label: string }>) {
  return (
    <Tooltip wide side="right" label={label}>
      <Info className="size-3.5 cursor-help text-muted-foreground/60 hover:text-muted-foreground" />
    </Tooltip>
  );
}

function useInstallName(tool: NotebookTool) {
  const { t } = useTranslation(["settings"]);
  return (install: Pick<NotebookToolInstall, "version">) =>
    install.version
      ? t(($) => $.settings.engine.notebook.active.version, {
          tool: NOTEBOOK_TOOL_LABELS[tool],
          version: install.version,
        })
      : NOTEBOOK_TOOL_LABELS[tool];
}

function RemoveManagedButton({ tool }: Readonly<{ tool: NotebookTool }>) {
  const { t } = useTranslation(["common", "settings"]);
  const installs = useNotebookToolchainStore((s) => s.installs);
  const status = useNotebookToolchainStore((s) => s.status);
  const removing = useNotebookToolchainStore((s) => s.removing);
  const remove = useNotebookToolchainStore((s) => s.remove);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="ml-auto h-7 shrink-0"
      aria-label={t(($) => $.settings.engine.notebook.removeAria, { tool: NOTEBOOK_TOOL_LABELS[tool] })}
      disabled={removing !== null || notebookToolBusy(tool, installs, status)}
      onClick={() => void remove(tool)}
    >
      <Trash2 className="size-3.5" /> {t(($) => $.common.actions.remove)}
    </Button>
  );
}

function sourceBadge(install: NotebookToolInstall, labels: Readonly<Record<NotebookToolInstall["source"], string>>) {
  return (
    <Badge variant={install.source === "managed" ? "success" : "muted"} size="sm">
      {labels[install.source]}
    </Badge>
  );
}

function ActiveToolCard({ tool, status }: Readonly<{ tool: NotebookTool; status: NotebookToolStatus }>) {
  const { t } = useTranslation(["settings"]);
  const installName = useInstallName(tool);
  const active = status.active;
  const sources = {
    system: t(($) => $.settings.engine.notebook.source.system),
    managed: t(($) => $.settings.engine.notebook.source.managed),
  };
  return (
    <div
      className={cn("rounded-lg border p-3", active && "border-primary")}
      data-testid={`${tool}-engine-active`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {active?.source === "system" ? (
          <HardDrive className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <Cpu className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="text-sm">{active ? installName(active) : NOTEBOOK_TOOL_LABELS[tool]}</span>
        {active && sourceBadge(active, sources)}
        {active && <CheckBadge tone="success" />}
        {active?.source === "managed" && <RemoveManagedButton tool={tool} />}
      </div>
      <p className="mt-1 text-[0.6875rem] text-muted-foreground">
        {active
          ? t(($) => $.settings.engine[tool].detail)
          : t(($) => $.settings.engine.notebook.active.missing)}
      </p>
      {active && (
        <p className="mt-1 truncate font-mono text-[0.625rem] text-muted-foreground/70">
          <SettingsPath path={active.path} />
        </p>
      )}
    </div>
  );
}

function IdleManagedCard({ tool, managed }: Readonly<{ tool: NotebookTool; managed: NotebookToolInstall }>) {
  const { t } = useTranslation(["settings"]);
  const installName = useInstallName(tool);
  return (
    <div className="rounded-lg border p-3" data-testid={`${tool}-engine-managed`}>
      <div className="flex flex-wrap items-center gap-2">
        <Cpu className="size-4 shrink-0 text-muted-foreground" />
        <span className="text-sm">{installName(managed)}</span>
        <Badge variant="success" size="sm">
          {t(($) => $.settings.engine.notebook.source.managed)}
        </Badge>
        <RemoveManagedButton tool={tool} />
      </div>
      <p className="mt-1 text-[0.6875rem] text-muted-foreground">
        {t(($) => $.settings.engine.notebook.managedIdle)}
      </p>
      <p className="mt-1 truncate font-mono text-[0.625rem] text-muted-foreground/70">
        <SettingsPath path={managed.path} />
      </p>
    </div>
  );
}

function SupersededToolCard({
  tool,
  pinnedVersion,
  versions,
}: Readonly<{ tool: NotebookTool; pinnedVersion: string; versions: readonly string[] }>) {
  const { t } = useTranslation(["settings"]);
  const label = NOTEBOOK_TOOL_LABELS[tool];
  return (
    <div className="rounded-lg border p-3" data-testid={`${tool}-engine-superseded`}>
      <div className="flex flex-wrap items-center gap-2">
        <Cpu className="size-4 shrink-0 text-muted-foreground" />
        <span className="text-sm">{`${label} ${versions.join(", ")}`}</span>
        <Badge variant="muted" size="sm">
          {t(($) => $.settings.engine.notebook.source.managed)}
        </Badge>
        <RemoveManagedButton tool={tool} />
      </div>
      <p className="mt-1 text-[0.6875rem] text-muted-foreground">
        {t(($) => $.settings.engine.notebook.superseded, { tool: label, version: pinnedVersion })}
      </p>
    </div>
  );
}

function DownloadToolCard({ tool, status }: Readonly<{ tool: NotebookTool; status: NotebookToolStatus }>) {
  const { t } = useTranslation(["settings"]);
  const installs = useNotebookToolchainStore((s) => s.installs);
  const toolchain = useNotebookToolchainStore((s) => s.status);
  const removing = useNotebookToolchainStore((s) => s.removing);
  const install = useNotebookToolchainStore((s) => s.install);
  const installing = installs[tool] ?? null;
  const label = NOTEBOOK_TOOL_LABELS[tool];
  const size = status.downloadBytes ? formatDownloadSize(status.downloadBytes) : "";
  const detail = status.offered
    ? [
        status.active ? t(($) => $.settings.engine.notebook.download.optional) : null,
        t(($) => $.settings.engine[tool].downloadDetail),
        t(($) => $.settings.engine.notebook.download.license, { license: status.license }),
      ]
        .filter((part): part is string => Boolean(part))
        .join(" ")
    : t(($) => $.settings.engine.notebook.download.notOffered, { tool: label });
  const action = size
    ? t(($) => $.settings.engine.notebook.download.action, { tool: label, version: status.pinnedVersion, size })
    : t(($) => $.settings.engine.notebook.download.actionNoSize, { tool: label, version: status.pinnedVersion });

  return (
    <div className="rounded-lg border p-3" data-testid={`${tool}-engine-download`}>
      <div className="flex items-center gap-2">
        <Download className="size-4 shrink-0 text-muted-foreground" />
        <span className="text-sm">{`${label} ${status.pinnedVersion}`}</span>
      </div>
      <p className="mt-1 text-[0.6875rem] leading-relaxed text-muted-foreground">{detail}</p>
      {status.offered && (
        <div className="mt-2">
          {installing ? (
            <div className="flex items-center gap-2" data-testid={`${tool}-engine-progress`}>
              <Progress
                value={notebookInstallPercent(installing) ?? 0}
                className="max-w-48"
                indicatorClassName="bg-primary"
              />
              <span className="shrink-0 text-[0.6875rem] text-muted-foreground">
                {notebookInstallLabel(installing)}
              </span>
            </div>
          ) : (
            <Button
              type="button"
              size="sm"
              disabled={notebookToolBusy(tool, installs, toolchain, removing)}
              onClick={() => void install(tool)}
            >
              <Download className="size-3.5" />
              {action}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function LanguageRow({ name, runtime }: Readonly<{ name: LanguageRuntimeName; runtime: LanguageRuntime | undefined }>) {
  const { t } = useTranslation(["settings"]);
  const path = runtime?.path ?? null;
  return (
    <div
      data-testid={`notebook-language-${name}`}
      className="flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm">{RUNTIME_LABELS[name]}</span>
          {path && runtime?.version && (
            <span className="font-mono text-[0.6875rem] text-muted-foreground">{runtime.version}</span>
          )}
        </div>
        {path ? (
          <p className="truncate font-mono text-[0.625rem] text-muted-foreground/70">
            <SettingsPath path={path} />
          </p>
        ) : (
          <p className="text-[0.6875rem] text-muted-foreground">
            {t(($) => $.settings.engine.notebook.languages.notFound)}
          </p>
        )}
      </div>
      {path && <CheckBadge tone="success" />}
    </div>
  );
}

function LanguagesCard({ runtimes }: Readonly<{ runtimes: readonly LanguageRuntime[] }>) {
  return (
    <div className="overflow-hidden rounded-lg border" data-testid="notebook-languages">
      {RUNTIME_ORDER.map((name) => (
        <LanguageRow key={name} name={name} runtime={runtimes.find((runtime) => runtime.name === name)} />
      ))}
    </div>
  );
}

const NO_RUNTIMES: readonly LanguageRuntime[] = [];

export function NotebookEngineTab({ tool }: Readonly<{ tool: NotebookTool }>) {
  const { t } = useTranslation(["common", "settings"]);
  const status = useNotebookToolchainStore((s) => s.status);
  const loadFailed = useNotebookToolchainStore((s) => s.loadFailed);
  const refresh = useNotebookToolchainStore((s) => s.refresh);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const toolStatus = status?.[tool] ?? null;

  const renderTool = () => {
    if (toolStatus) {
      const superseded = toolStatus.supersededVersions ?? [];
      return (
        <>
          <ActiveToolCard tool={tool} status={toolStatus} />
          {toolStatus.managed && toolStatus.active?.source !== "managed" && (
            <IdleManagedCard tool={tool} managed={toolStatus.managed} />
          )}
          {!toolStatus.managed && <DownloadToolCard tool={tool} status={toolStatus} />}
          {!toolStatus.managed && superseded.length > 0 && (
            <SupersededToolCard tool={tool} pinnedVersion={toolStatus.pinnedVersion} versions={superseded} />
          )}
        </>
      );
    }
    if (!loadFailed) {
      return <p className="text-xs text-muted-foreground">{t(($) => $.settings.engine.notebook.loading)}</p>;
    }
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground">{t(($) => $.settings.engine.notebook.error.load)}</p>
        <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => void refresh()}>
          {t(($) => $.common.actions.retry)}
        </Button>
      </div>
    );
  };

  return (
    <>
      <div className="flex items-center gap-1.5">
        <SectionHeading>{t(($) => $.settings.engine[tool].heading)}</SectionHeading>
        <InfoTip label={t(($) => $.settings.engine[tool].tooltip)} />
      </div>
      {renderTool()}
      {tool === "calepin" && (
        <p className="text-xs text-muted-foreground">{t(($) => $.settings.engine.calepin.typstNote)}</p>
      )}
      <div className="flex items-center gap-1.5">
        <SectionHeading>{t(($) => $.settings.engine.notebook.languages.heading)}</SectionHeading>
        <InfoTip label={t(($) => $.settings.engine.notebook.languages.tooltip)} />
      </div>
      {status && <LanguagesCard runtimes={status.runtimes ?? NO_RUNTIMES} />}
      <p className="text-xs text-muted-foreground">
        {t(($) => $.settings.engine.notebook.languages.note)} {t(($) => $.settings.engine.notebook.codeNote)}
      </p>
    </>
  );
}
