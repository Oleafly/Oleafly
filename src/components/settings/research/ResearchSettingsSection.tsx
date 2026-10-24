import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ErrorState } from "@/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ResetToDefaults } from "@/components/settings/ResetToDefaults";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsToggleRow } from "@/components/settings/SettingsToggleRow";
import { durationLabel, TIME_BUDGET_OPTIONS } from "@/components/research/tasks/brief/BriefFields";
import { researchNotificationPermission, type NotificationPermission } from "@/lib/research-tasks";
import { getConfig, mcpServersList, setConfig as saveConfig, type AppConfig } from "@/lib/tauri";
import { ResearchCard } from "./ResearchCard";
import { ResearchBackgroundSlot, ResearchComputeSlot } from "./slots";

/** The config keys this section writes; a save sets only the ones its change touched. */
const OWNED_KEYS = [
  "research_keep_awake",
  "research_notifications",
  "research_command_network",
  "research_time_budget_minutes",
  "research_task_mcp_servers",
] as const satisfies readonly (keyof AppConfig)[];

type OwnedKey = (typeof OWNED_KEYS)[number];

/** The defaults the app config starts with (see `AppConfig::default` in the Rust config). */
function researchDefaults(): Pick<AppConfig, OwnedKey> {
  return {
    research_keep_awake: true,
    research_notifications: true,
    research_command_network: false,
    research_time_budget_minutes: 120,
    research_task_mcp_servers: [],
  };
}

/** Settings › Research: defaults and behaviour of research tasks. */
export function ResearchSettingsSection() {
  const { t } = useTranslation(["common", "researchTools", "settings"]);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [servers, setServers] = useState<string[] | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const request = useRef(0);
  // The settings as the switches show them, for the saves waiting in line.
  const shown = useRef<AppConfig | null>(null);
  const saves = useRef<Promise<void>>(Promise.resolve());
  // The patches of the saves in line, oldest first.
  const waiting = useRef<Partial<AppConfig>[]>([]);
  const [serversFailed, setServersFailed] = useState(false);
  const serversRequest = useRef(0);

  const loadServers = useCallback(() => {
    const current = ++serversRequest.current;
    setServersFailed(false);
    void mcpServersList()
      .then((list) => {
        if (current === serversRequest.current) setServers(list.map((server) => server.config.name));
      })
      .catch(() => {
        if (current === serversRequest.current) setServersFailed(true);
      });
  }, []);

  useEffect(() => {
    loadServers();
    return () => {
      serversRequest.current += 1;
    };
  }, [loadServers]);

  useEffect(() => {
    let live = true;
    void researchNotificationPermission(false)
      .then((state) => {
        if (live) setPermission(state);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const loadConfig = useCallback(() => {
    const current = ++request.current;
    setLoadFailed(false);
    void getConfig()
      .then((next) => {
        if (current !== request.current) return;
        shown.current = next;
        setConfig(next);
      })
      .catch(() => {
        if (current === request.current) setLoadFailed(true);
      });
  }, []);

  useEffect(() => {
    loadConfig();
    return () => {
      request.current += 1;
    };
  }, [loadConfig]);

  const write = (patch: Partial<AppConfig>) => {
    const before = shown.current;
    if (!before) return;
    const next = { ...before, ...patch };
    shown.current = next;
    setConfig(next);
    setSaveFailed(false);
    waiting.current.push(patch);
    // Changes when the section closes or loads the config again.
    const generation = request.current;
    // Each save reads the config again and sets only the keys of this change, so
    // a change another writer made to anything else is not written over.
    saves.current = saves.current
      .then(async () => {
        try {
          const latest = await getConfig();
          await saveConfig({ ...latest, ...patch });
        } catch {
          setSaveFailed(true);
          // Show what is stored, with the changes still waiting to be saved on top.
          try {
            const stored = await getConfig();
            if (request.current !== generation) return;
            shown.current = Object.assign({ ...stored }, ...waiting.current.slice(1)) as AppConfig;
            setConfig(shown.current);
          } catch {
            // The switches keep what they showed.
          }
        } finally {
          waiting.current.shift();
        }
      });
  };

  const askPermission = async () => {
    try {
      setPermission(await researchNotificationPermission(true));
    } catch {
      setPermission("denied");
    }
  };

  const chosenServers = config?.research_task_mcp_servers ?? [];
  // Chosen names the server list no longer has (renamed or removed), so they can be unticked.
  const missingServers = servers ? chosenServers.filter((name) => !servers.includes(name)) : [];
  const minutes = config?.research_time_budget_minutes ?? 120;
  const budgetOptions = TIME_BUDGET_OPTIONS.includes(minutes)
    ? TIME_BUDGET_OPTIONS
    : [...TIME_BUDGET_OPTIONS, minutes].sort((a, b) => a - b);
  const defaults = researchDefaults();
  const changed =
    config !== null &&
    OWNED_KEYS.some((key) => {
      const value = config[key] ?? defaults[key];
      return Array.isArray(value) ? value.length > 0 : value !== defaults[key];
    });

  return (
    <div className="space-y-4" data-testid="research-settings">
      <ResearchCard
        id="research-settings-title"
        icon={FlaskConical}
        title={t(($) => $.researchTools.tasks.settings.title)}
      >
        {loadFailed ? (
          <ErrorState size="compact" message={t(($) => $.researchTools.tasks.settings.loadFailed)}>
            <Button size="xs" variant="outline" onClick={loadConfig}>
              {t(($) => $.common.actions.retry)}
            </Button>
          </ErrorState>
        ) : null}
        <SettingsToggleRow
          label={t(($) => $.researchTools.tasks.settings.keepAwake)}
          description={t(($) => $.researchTools.tasks.settings.keepAwakeHint)}
          checked={config?.research_keep_awake !== false}
          disabled={!config}
          onChange={(value) => write({ research_keep_awake: value })}
        />
        <SettingsToggleRow
          label={t(($) => $.researchTools.tasks.settings.notifications)}
          description={t(($) => $.researchTools.tasks.settings.notificationsHint)}
          checked={config?.research_notifications !== false}
          disabled={!config}
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
          description={t(($) => $.researchTools.tasks.settings.networkHint)}
          checked={config?.research_command_network === true}
          disabled={!config}
          onChange={(value) => write({ research_command_network: value })}
        />
        <SettingsRow
          label={<label htmlFor="research-time-budget">{t(($) => $.researchTools.tasks.settings.timeBudget)}</label>}
          control={
            <Select
              value={String(minutes)}
              disabled={!config}
              onValueChange={(value) => write({ research_time_budget_minutes: Number(value) })}
            >
              <SelectTrigger id="research-time-budget" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[100]">
                {budgetOptions.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {durationLabel(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <fieldset className="space-y-2">
          <legend className="text-sm">{t(($) => $.researchTools.tasks.settings.mcpServers)}</legend>
          <p className="text-xs text-muted-foreground">
            {t(($) => $.researchTools.tasks.settings.mcpServersHint)}
          </p>
          {serversFailed ? (
            <ErrorState size="compact" message={t(($) => $.settings.research.mcpServers.loadFailed)}>
              <Button size="xs" variant="outline" onClick={loadServers}>
                {t(($) => $.common.actions.retry)}
              </Button>
            </ErrorState>
          ) : null}
          {!serversFailed && servers?.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t(($) => $.researchTools.tasks.settings.noMcpServers)}</p>
          ) : null}
          {serversFailed
            ? null
            : [...(servers ?? []), ...missingServers].map((name) => {
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
                    <span className="truncate">
                      {missingServers.includes(name)
                        ? t(($) => $.settings.research.mcpServers.missing, { name })
                        : name}
                    </span>
                  </label>
                );
              })}
        </fieldset>
        {saveFailed ? (
          <p role="alert" className="text-xs text-destructive">
            {t(($) => $.researchTools.tasks.settings.saveFailed)}
          </p>
        ) : null}
        <ResetToDefaults
          sectionName={t(($) => $.researchTools.tasks.settings.sectionName)}
          confirmationDescription={t(($) => $.researchTools.tasks.settings.resetConfirm)}
          disabled={!config}
          changed={changed}
          onReset={() => write(researchDefaults())}
        />
      </ResearchCard>
      {ResearchComputeSlot ? <ResearchComputeSlot /> : null}
      {ResearchBackgroundSlot ? <ResearchBackgroundSlot /> : null}
    </div>
  );
}
