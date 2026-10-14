import { SettingsSwitchIndicator } from "@/components/settings/SettingsToggleRow";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatDateTime } from "@/lib/intl";
import { cn } from "@/lib/utils";
import { useCloudStore } from "@/store/cloud";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export function CloudProjectsCard() {
  const { t } = useTranslation(["shell"]);
  const state = useCloudStore((s) => s.state);
  const syncing = useCloudStore((s) => s.syncing);
  const lastReport = useCloudStore((s) => s.lastReport);
  const syncNow = useCloudStore((s) => s.syncNow);
  const setProjectMode = useCloudStore((s) => s.setProjectMode);
  const downloadProject = useCloudStore((s) => s.downloadProject);
  const [open, setOpen] = useState(false);

  if (state?.status !== "connected") return null;
  const projects = state.projects ?? [];

  return (
    <div className="border-t">
      <div className="flex items-center gap-3 px-5 py-4">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronRight
            aria-hidden
            className={cn(
              "size-4 shrink-0 text-muted-foreground motion-safe:transition-transform",
              open && "rotate-90",
            )}
          />
          <span className="min-w-0">
            <span className="block font-semibold text-foreground">
              {t(($) => $.shell.settings.data.cloud.projectsTitle)}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {syncing
                ? t(($) => $.shell.settings.data.cloud.syncing)
                : lastReport && lastReport.lastSyncedMs > 0
                  ? t(($) => $.shell.settings.data.cloud.lastSynced, {
                      time: formatDateTime(lastReport.lastSyncedMs),
                    })
                  : t(($) => $.shell.settings.data.cloud.lead)}
            </span>
          </span>
        </button>
        <Button
          type="button"
          size="sm"
          className="shrink-0"
          disabled={syncing || !state.enabled}
          onClick={() => void syncNow(true)}
        >
          {syncing ? <Spinner size="sm" /> : null}
          {t(($) => $.shell.settings.data.cloud.syncNow)}
        </Button>
      </div>
      {open ? (
        projects.length === 0 ? (
          <p className="border-t px-5 py-4 text-xs text-muted-foreground">
            {t(($) => $.shell.settings.data.cloud.noProjects)}
          </p>
        ) : (
          <ul className="divide-y border-t">
            {projects.map((project) => (
              <li
                key={project.cloudId || project.localId || project.name}
                className="flex items-center gap-3 px-5 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{project.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {project.mode === "download"
                      ? t(($) => $.shell.settings.data.cloud.inDropboxOnly)
                      : project.lastSyncedMs > 0
                        ? t(($) => $.shell.settings.data.cloud.lastSynced, {
                            time: formatDateTime(project.lastSyncedMs),
                          })
                        : t(($) => $.shell.settings.data.cloud.neverSynced)}
                  </p>
                </div>
                {project.localId ? (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={project.mode === "sync"}
                    aria-label={t(($) => $.shell.settings.data.cloud.syncProjectSwitch, { name: project.name })}
                    className="shrink-0 rounded-full focus-visible:bg-accent"
                    onClick={() =>
                      void setProjectMode(project.localId as string, project.mode === "sync" ? "pause" : "sync")
                    }
                  >
                    <SettingsSwitchIndicator checked={project.mode === "sync"} />
                  </button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    disabled={syncing}
                    onClick={() => void downloadProject(project.cloudId, project.name)}
                  >
                    {t(($) => $.shell.settings.data.cloud.download)}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
