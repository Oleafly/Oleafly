import { useId, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import { SlidersHorizontal } from "@/components/icons/pack";
import { useTranslation } from "react-i18next";
import { UsageMeter } from "@/components/ai/usage/UsageMeter";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { SectionHeading } from "@/components/ui/section-heading";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";
import {
  acpError, acpRefreshPlanUsage, acpSetConfigOption, acpSetMode, acpSetModel,
  type AcpConfigOption, type AcpConfigValue, type AcpSession, type AcpSnapshot,
} from "@/lib/acp";
import { cn } from "@/lib/utils";
import { useAcpSessionsStore } from "@/store/acp-sessions";
import {
  currentModeId, currentModelId, currentName, entryChoiceId, groupControls, groupHeadings, listboxFocusTarget,
  modeChoices, modelChoices, type ModeControl, type ModelControl,
} from "./acp-controls";
import { canRefreshPlan, toUsageSnapshot, usageTooltip } from "./acp-usage";

const TRIGGER = "h-7 w-auto min-w-0 max-w-44 gap-1 border-0 bg-transparent px-2 text-xs font-medium shadow-none hover:bg-accent focus-visible:bg-accent";

function modelLabel(control: ModelControl): string | null {
  if (control.kind === "config") return currentName(control.option);
  return control.models.find((model) => model.modelId === control.current)?.name ?? control.current;
}

function moveOptionFocus(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]')];
  const target = listboxFocusTarget(
    options.map((option) => (option.disabled ? null : (option.textContent ?? ""))),
    options.indexOf(document.activeElement as HTMLButtonElement),
    event.key,
  );
  if (target === null) return;
  event.preventDefault();
  options[target]?.focus();
}

type SetOption = (option: AcpConfigOption, value: AcpConfigValue) => void;

function ModelConfigRow({
  option,
  idPrefix,
  locked,
  setOption,
}: Readonly<{ option: AcpConfigOption; idPrefix: string; locked: boolean; setOption: SetOption }>) {
  if (option.kind.type === "boolean") {
    return (
      <label htmlFor={`${idPrefix}-${option.id}`} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent">
        <span className="truncate">{option.name}</span>
        <Switch
          id={`${idPrefix}-${option.id}`}
          checked={option.kind.currentValue}
          disabled={locked}
          aria-label={option.name}
          onCheckedChange={(checked) => setOption(option, { type: "boolean", value: checked })}
        />
      </label>
    );
  }
  if (option.kind.type === "select") {
    return (
      <div className="flex items-center justify-between gap-2 px-2 py-1 text-xs">
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
    );
  }
  return null;
}

function ModelPicker({
  model,
  modelConfig,
  modelId,
  locked,
  onChoose,
  setOption,
}: Readonly<{
  model: ModelControl | null;
  modelConfig: AcpConfigOption[];
  modelId: string | null;
  locked: boolean;
  onChoose(model: ModelControl, id: string): void;
  setOption: SetOption;
}>) {
  const { t } = useTranslation(["common", "ai"]);
  const idPrefix = useId();
  const choices = modelChoices(model);
  if (!model || choices.length === 0) {
    return (
      <span data-testid="acp-model-label" className="hidden max-w-40 truncate px-1 text-[0.6875rem] text-muted-foreground sm:inline">
        {(model ? modelLabel(model) : null) ?? modelId ?? t(($) => $.ai.acp.modelManaged)}
      </span>
    );
  }
  const current = currentModelId(model);
  const headings = groupHeadings(choices);
  const entryChoice = entryChoiceId(choices, current);
  return (
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
      <div
        role="listbox"
        aria-label={t(($) => $.ai.acp.agentModel)}
        tabIndex={-1}
        className="flex flex-col"
        onKeyDown={moveOptionFocus}
      >
        {choices.map((choice, index) => {
          const selected = choice.id === current;
          return (
            <div key={choice.id}>
              {headings[index] && <SectionHeading as="div" className="px-2 pb-0.5 pt-2">{headings[index]}</SectionHeading>}
              <Button
                type="button"
                variant="ghost"
                size="xs"
                role="option"
                aria-selected={selected}
                aria-disabled={choice.blocked}
                disabled={choice.blocked}
                tabIndex={choice.id === entryChoice ? 0 : -1}
                className={cn(
                  "h-auto w-full justify-between gap-2 px-2 py-1.5 text-left text-xs font-normal [&_svg]:size-3.5",
                  selected && "bg-accent/60",
                )}
                onClick={() => {
                  if (!selected) onChoose(model, choice.id);
                }}
              >
                <span className="truncate">{choice.name}</span>
                {selected && <Check />}
              </Button>
            </div>
          );
        })}
        {modelConfig.length > 0 && <div className="my-1 border-t" />}
        {modelConfig.map((option) => (
          <ModelConfigRow key={option.id} option={option} idPrefix={idPrefix} locked={locked} setOption={setOption} />
        ))}
      </div>
    </Popover>
  );
}

function ModeSelect({
  mode,
  locked,
  onChoose,
}: Readonly<{ mode: ModeControl; locked: boolean; onChoose(mode: ModeControl, value: string): void }>) {
  const { t } = useTranslation(["common", "ai"]);
  return (
    <Select value={currentModeId(mode) ?? ""} disabled={locked} onValueChange={(value) => onChoose(mode, value)}>
      <SelectTrigger aria-label={t(($) => $.ai.acp.controls.mode)} data-testid="acp-mode-picker" className={TRIGGER}>
        <SelectValue placeholder={t(($) => $.ai.acp.controls.mode)} />
      </SelectTrigger>
      <SelectContent className="z-[100]" align="end">
        {modeChoices(mode).map((choice) => (
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
  );
}

function MoreOptionItem({ option, setOption }: Readonly<{ option: AcpConfigOption; setOption: SetOption }>) {
  if (option.kind.type === "boolean") {
    return (
      <DropdownMenuCheckboxItem
        checked={option.kind.currentValue}
        onCheckedChange={(checked) => setOption(option, { type: "boolean", value: checked === true })}
      >
        {option.name}
      </DropdownMenuCheckboxItem>
    );
  }
  if (option.kind.type === "select") {
    return (
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
    );
  }
  return null;
}

function MoreOptions({
  options,
  locked,
  setOption,
}: Readonly<{ options: AcpConfigOption[]; locked: boolean; setOption: SetOption }>) {
  const { t } = useTranslation(["common", "ai"]);
  return (
    <DropdownMenu>
      <Tooltip label={t(($) => $.ai.acp.controls.more)}>
        <DropdownMenuTrigger asChild disabled={locked}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-testid="acp-more-options"
            aria-label={t(($) => $.ai.acp.controls.more)}
            disabled={locked}
            className="size-7 shrink-0 rounded-full text-muted-foreground [&_svg]:size-3.5"
          >
            <SlidersHorizontal />
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" className="z-[100] w-60">
        {options.map((option, index) => (
          <div key={option.id}>
            {index > 0 && <DropdownMenuSeparator />}
            <MoreOptionItem option={option} setOption={setOption} />
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AcpControls({
  projectId,
  session,
  disabled,
  onError,
}: Readonly<{ projectId: string; session: AcpSession; disabled: boolean; onError(message: string | null): void }>) {
  const { t } = useTranslation(["common", "ai"]);
  const [refreshing, setRefreshing] = useState(false);
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
  const setOption: SetOption = (option, value) =>
    apply(() => acpSetConfigOption(projectId, session.id, option.id, value));
  const chooseModel = (model: ModelControl, id: string) => {
    if (model.kind === "config") setOption(model.option, id);
    else apply(() => acpSetModel(projectId, session.id, id));
  };
  const chooseMode = (mode: ModeControl, value: string) => {
    if (mode.kind === "config") setOption(mode.option, value);
    else apply(() => acpSetMode(projectId, session.id, value));
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

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <ModelPicker
        model={groups.model}
        modelConfig={groups.modelConfig}
        modelId={session.controls.modelId}
        locked={locked}
        onChoose={chooseModel}
        setOption={setOption}
      />
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
      {groups.mode && <ModeSelect key={`${session.id}:mode`} mode={groups.mode} locked={locked} onChoose={chooseMode} />}
      {groups.more.length > 0 && <MoreOptions options={groups.more} locked={locked} setOption={setOption} />}
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
