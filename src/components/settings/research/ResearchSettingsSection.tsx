import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsToggleRow } from "@/components/settings/SettingsToggleRow";
import { durationLabel, TIME_BUDGET_OPTIONS } from "@/components/research/tasks/brief/BriefFields";
import { researchNotificationPermission, type NotificationPermission } from "@/lib/research-tasks";
import { getConfig, mcpServersList, setConfig, type AppConfig } from "@/lib/tauri";
import { ResearchBackgroundSlot, ResearchComputeSlot } from "./slots";

/** Settings › Research: defaults and behaviour of research tasks. */
export function ResearchSettingsSection() {
  const { t } = useTranslation(["researchTools"]);
  const [config, setConfigState] = useState<AppConfig | null>(null);
  const [servers, setServers] = useState<string[] | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);

  useEffect(() => {
    const current = ++request.current;
    void getConfig()
      .then((next) => {
        if (current === request.current) setConfigState(next);
      })
      .catch(() => setFailed(true));
    void mcpServersList()
      .then((list) => {
        if (current === request.current) setServers(list.map((server) => server.config.name));
      })
      .catch(() => setServers([]));
    void researchNotificationPermission(false)
      .then((state) => {
        if (current === request.current) setPermission(state);
      })
      .catch(() => {});
    return () => {
      request.current += 1;
    };
  }, []);

  const write = (patch: Partial<AppConfig>) => {
    if (!config) return;
    const next = { ...config, ...patch };
    setConfigState(next);
    setFailed(false);
    void setConfig(next).catch(() => setFailed(true));
  };

  const askPermission = async () => {
    try {
      setPermission(await researchNotificationPermission(true));
    } catch {
      setPermission("denied");
    }
  };

  const chosenServers = config?.research_task_mcp_servers ?? [];
  const minutes = config?.research_time_budget_minutes ?? 120;
  const budgetOptions = TIME_BUDGET_OPTIONS.includes(minutes)
    ? TIME_BUDGET_OPTIONS
    : [...TIME_BUDGET_OPTIONS, minutes].sort((a, b) => a - b);

  return (
    <div className="space-y-4" data-testid="research-settings">
      <section
        aria-labelledby="research-settings-title"
        className="overflow-hidden rounded-xl border bg-card/60"
      >
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FlaskConical aria-hidden className="size-4" />
          </span>
          <h3 id="research-settings-title" className="font-medium">
            {t(($) => $.researchTools.tasks.settings.title)}
          </h3>
        </div>
        <div className="space-y-3 px-4 py-4">
          <SettingsToggleRow
            label={t(($) => $.researchTools.tasks.settings.keepAwake)}
            description={t(($) => $.researchTools.tasks.settings.keepAwakeHint)}
            checked={config?.research_keep_awake !== false}
            onChange={(value) => write({ research_keep_awake: value })}
          />
          <SettingsToggleRow
            label={t(($) => $.researchTools.tasks.settings.notifications)}
            description={t(($) => $.researchTools.tasks.settings.notificationsHint)}
            checked={config?.research_notifications !== false}
            onChange={(value) => write({ research_notifications: value })}
          />
          {config?.research_notifications !== false && permission && permission !== "granted" ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs">
              <span className="text-muted-foreground">
                {t(($) => $.researchTools.tasks.settings.notificationsBlocked)}
              </span>
              <Button size="xs" variant="outline" onClick={() => void askPermission()}>
                {t(($) => $.researchTools.tasks.settings.allowNotifications)}
              </Button>
            </div>
          ) : null}
          <SettingsToggleRow
            label={t(($) => $.researchTools.tasks.settings.network)}
            checked={config?.research_command_network === true}
            onChange={(value) => write({ research_command_network: value })}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label htmlFor="research-time-budget" className="text-sm">
              {t(($) => $.researchTools.tasks.settings.timeBudget)}
            </label>
            <Select
              value={String(minutes)}
              disabled={!config}
              onValueChange={(value) => write({ research_time_budget_minutes: Number(value) })}
            >
              <SelectTrigger id="research-time-budget" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {budgetOptions.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {durationLabel(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm">{t(($) => $.researchTools.tasks.settings.mcpServers)}</legend>
            <p className="text-xs text-muted-foreground">
              {t(($) => $.researchTools.tasks.settings.mcpServersHint)}
            </p>
            {servers && servers.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t(($) => $.researchTools.tasks.settings.noMcpServers)}</p>
            ) : null}
            {servers?.map((name) => {
              const id = `research-mcp-${name}`;
              return (
                <label key={name} htmlFor={id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    id={id}
                    disabled={!config}
                    checked={chosenServers.includes(name)}
                    onCheckedChange={(next) =>
                      write({
                        research_task_mcp_servers:
                          next === true
                            ? [...chosenServers, name]
                            : chosenServers.filter((chosen) => chosen !== name),
                      })
                    }
                  />
                  <span className="truncate">{name}</span>
                </label>
              );
            })}
          </fieldset>
          {failed ? (
            <p role="alert" className="text-xs text-destructive">
              {t(($) => $.researchTools.tasks.settings.saveFailed)}
            </p>
          ) : null}
        </div>
      </section>
      {ResearchComputeSlot ? <ResearchComputeSlot /> : null}
      {ResearchBackgroundSlot ? <ResearchBackgroundSlot /> : null}
    </div>
  );
}
