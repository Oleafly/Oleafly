import { useId, useState } from "react";
import { Check, ChevronDown, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { UsageMeter } from "@/components/ai/usage/UsageMeter";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";
import {
  acpError, acpRefreshPlanUsage, acpSetConfigOption, acpSetMode, acpSetModel,
  type AcpConfigOption, type AcpConfigValue, type AcpSession, type AcpSnapshot,
} from "@/lib/acp";
import { cn } from "@/lib/utils";
import { useAcpSessionsStore } from "@/store/acp-sessions";
import { currentName, groupControls, type ModelControl } from "./acp-controls";
import { canRefreshPlan, toUsageSnapshot, usageTooltip } from "./acp-usage";

const TRIGGER = "h-7 w-auto min-w-0 max-w-44 gap-1 border-0 bg-transparent px-2 text-xs font-medium shadow-none hover:bg-accent focus-visible:bg-accent";

function modelLabel(control: ModelControl): string | null {
  if (control.kind === "config") return currentName(control.option);
  return control.models.find((model) => model.modelId === control.current)?.name ?? control.current;
}

/** Model, effort, mode, Fast and the rest of the agent's options, plus usage. */
export function AcpControls({
  projectId,
  session,
  disabled,
  onError,
}: Readonly<{ projectId: string; session: AcpSession; disabled: boolean; onError(message: string | null): void }>) {
  const { t } = useTranslation(["common", "ai"]);
  const idPrefix = useId();
  const [refreshing, setRefreshing] = useState(false);
  // One change at a time: the controls wait until the agent has answered.
  const [pending, setPending] = useState(false);
  const groups = groupControls(session.controls);
  const locked = disabled || pending || session.status !== "ready";

  const apply = (change: () => Promise<AcpSnapshot>) => {
    onError(null);
    setPending(true);
    void change()
      .then((snapshot) => useAcpSessionsStore.getState().setSnapshot(snapshot))
      .catch((error: unknown) => onError(acpError(error)))
      .finally(() => setPending(false));
  };
  const setOption = (option: AcpConfigOption, value: AcpConfigValue) =>
    apply(() => acpSetConfigOption(projectId, session.id, option.id, value));

  const model = groups.model;
  const modelChoices = model?.kind === "config" && model.option.kind.type === "select"
    ? model.option.kind.options.map((choice) => ({ id: choice.value, name: choice.name, group: choice.group, blocked: choice.blocked }))
    : model?.kind === "legacy"
      ? model.models.map((entry) => ({ id: entry.modelId, name: entry.name, group: null, blocked: false }))
      : [];
  const currentModel = model?.kind === "config" && model.option.kind.type === "select"
    ? model.option.kind.currentValue
    : model?.kind === "legacy" ? model.current : null;
  const chooseModel = (id: string) => {
    if (!model || id === currentModel) return;
    if (model.kind === "config") setOption(model.option, id);
    else apply(() => acpSetModel(projectId, session.id, id));
  };

  const usage = toUsageSnapshot(session.usage);
  const refreshPlan = canRefreshPlan(session)
    ? () => {
        setRefreshing(true);
        onError(null);
        void acpRefreshPlanUsage(projectId, session.id)
          .then((snapshot) => useAcpSessionsStore.getState().setSnapshot(snapshot))
          .catch((error: unknown) => onError(acpError(error)))
          .finally(() => setRefreshing(false));
      }
    : undefined;

  let lastGroup: string | null = null;
  return (
    <div className="flex min-w-0 items-center gap-0.5">
      {model && modelChoices.length > 0 ? (
        <Popover
          align="right"
          closeOnClick
          disabled={locked}
          ariaLabel={t(($) => $.ai.acp.agentModel)}
          triggerClassName={TRIGGER}
          className="max-h-80 w-64 overflow-y-auto p-1"
          trigger={
            <span data-testid="acp-model-picker" className="flex min-w-0 items-center gap-1">
              <span className="truncate">{modelLabel(model) ?? t(($) => $.ai.acp.agentModel)}</span>
              <ChevronDown className="size-3 shrink-0 opacity-60" />
            </span>
          }
        >
          <div role="listbox" aria-label={t(($) => $.ai.acp.agentModel)} className="flex flex-col">
            {modelChoices.map((choice) => {
              const heading = choice.group && choice.group !== lastGroup ? choice.group : null;
              lastGroup = choice.group ?? lastGroup;
              return (
                <div key={choice.id}>
                  {heading && <div className="px-2 pb-0.5 pt-2 text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground">{heading}</div>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={choice.id === currentModel}
                    aria-disabled={choice.blocked}
                    disabled={choice.blocked}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-50",
                      choice.id === currentModel && "bg-accent/60",
                    )}
                    onClick={() => chooseModel(choice.id)}
                  >
                    <span className="truncate">{choice.name}</span>
                    {choice.id === currentModel && <Check className="size-3.5 shrink-0" />}
                  </button>
                </div>
              );
            })}
            {groups.modelConfig.length > 0 && <div className="my-1 border-t" />}
            {groups.modelConfig.map((option) => option.kind.type === "boolean" ? (
              <label key={option.id} htmlFor={`${idPrefix}-${option.id}`} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent">
                <span className="truncate">{option.name}</span>
                <Switch
                  id={`${idPrefix}-${option.id}`}
                  checked={option.kind.currentValue}
                  disabled={locked}
                  aria-label={option.name}
                  onCheckedChange={(checked) => setOption(option, { type: "boolean", value: checked })}
                />
              </label>
            ) : option.kind.type === "select" ? (
              <div key={option.id} className="flex items-center justify-between gap-2 px-2 py-1 text-xs">
                <span className="truncate">{option.name}</span>
                <Select value={option.kind.currentValue ?? ""} disabled={locked} onValueChange={(value) => setOption(option, value)}>
                  <SelectTrigger aria-label={option.name} className="h-6 w-auto gap-1 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent className="z-[110]">
                    {option.kind.options.map((choice) => (
                      <SelectItem key={choice.value} value={choice.value} disabled={choice.blocked}>{choice.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null)}
          </div>
        </Popover>
      ) : (
        // Without a list to pick from, name the model the agent runs.
        <span data-testid="acp-model-label" className="hidden max-w-40 truncate px-1 text-[0.6875rem] text-muted-foreground sm:inline">
          {(model ? modelLabel(model) : null) ?? session.controls.modelId ?? t(($) => $.ai.acp.modelManaged)}
        </span>
      )}
      {groups.effort?.kind.type === "select" && (
        <Select
          key={`${session.id}:effort`}
          value={groups.effort.kind.currentValue ?? ""}
          disabled={locked}
          onValueChange={(value) => groups.effort && setOption(groups.effort, value)}
        >
          <SelectTrigger aria-label={t(($) => $.ai.acp.controls.effort)} data-testid="acp-effort-picker" className={TRIGGER}>
            <SelectValue placeholder={t(($) => $.ai.acp.controls.effort)} />
          </SelectTrigger>
          <SelectContent className="z-[100]" align="end">
            {groups.effort.kind.options.map((choice) => (
              <SelectItem key={choice.value} value={choice.value}>{choice.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {groups.mode && (
        <Select
          key={`${session.id}:mode`}
          value={(groups.mode.kind === "config"
            ? groups.mode.option.kind.type === "select" ? groups.mode.option.kind.currentValue : null
            : groups.mode.current) ?? ""}
          disabled={locked}
          onValueChange={(value) => {
            const mode = groups.mode;
            if (!mode) return;
            if (mode.kind === "config") setOption(mode.option, value);
            else apply(() => acpSetMode(projectId, session.id, value));
          }}
        >
          <SelectTrigger aria-label={t(($) => $.ai.acp.controls.mode)} data-testid="acp-mode-picker" className={TRIGGER}>
            <SelectValue placeholder={t(($) => $.ai.acp.controls.mode)} />
          </SelectTrigger>
          <SelectContent className="z-[100]" align="end">
            {(groups.mode.kind === "config" && groups.mode.option.kind.type === "select"
              ? groups.mode.option.kind.options.map((choice) => ({ id: choice.value, name: choice.name, blocked: choice.blocked }))
              : groups.mode.kind === "legacy" ? groups.mode.modes : []
            ).map((choice) => (
              <SelectItem key={choice.id} value={choice.id} disabled={choice.blocked}>
                {choice.blocked ? (
                  <Tooltip label={t(($) => $.ai.acp.controls.blockedModeHint)}>
                    <span>{choice.name} · {t(($) => $.ai.acp.controls.blockedMode)}</span>
                  </Tooltip>
                ) : choice.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {groups.more.length > 0 && (
        <DropdownMenu>
          <Tooltip label={t(($) => $.ai.acp.controls.more)}>
            <DropdownMenuTrigger
              data-testid="acp-more-options"
              aria-label={t(($) => $.ai.acp.controls.more)}
              disabled={locked}
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
            >
              <SlidersHorizontal className="size-3.5" />
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent align="end" className="z-[100] w-60">
            {groups.more.map((option, index) => (
              <div key={option.id}>
                {index > 0 && <DropdownMenuSeparator />}
                {option.kind.type === "boolean" ? (
                  <DropdownMenuCheckboxItem
                    checked={option.kind.currentValue}
                    onCheckedChange={(checked) => setOption(option, { type: "boolean", value: checked === true })}
                  >
                    {option.name}
                  </DropdownMenuCheckboxItem>
                ) : option.kind.type === "select" ? (
                  <>
                    <DropdownMenuLabel className="text-xs">{option.name}</DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={option.kind.currentValue ?? ""} onValueChange={(value) => setOption(option, value)}>
                      {option.kind.options.map((choice) => (
                        <DropdownMenuRadioItem key={choice.value} value={choice.value} disabled={choice.blocked} className="text-xs">
                          {choice.name}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </>
                ) : null}
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <UsageMeter
        snapshot={usage}
        tooltip={usageTooltip(usage)}
        ariaLabel={t(($) => $.ai.acp.usage.ariaLabel)}
        onRefreshPlan={refreshPlan}
        refreshing={refreshing}
      />
    </div>
  );
}
