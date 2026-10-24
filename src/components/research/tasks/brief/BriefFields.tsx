import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { i18n } from "@/i18n";
import type { CommandPolicy, MetricGoal, ResearchBrief, RunProfile } from "@/lib/research-tasks";
import { useSettingsStore } from "@/store/settings";
import { DesktopAppsBriefField } from "./DesktopAppsBriefField";

export const TIME_BUDGET_OPTIONS = [30, 60, 120, 240, 480, 720, 1440];
const RUN_TIMEOUT_OPTIONS: Record<RunProfile, number[]> = {
  analysis: [10, 30, 60, 120],
  training: [60, 120, 240, 480, 720],
};
// The same rule as the task store: a letter or underscore first, then up to
// 63 letters, digits, dots, slashes, dashes or underscores.
const METRIC_NAME = /^[A-Za-z_][A-Za-z0-9_./-]{0,63}$/;

/** "90 minutes" or "2 hours" for a minute count. */
export function durationLabel(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) {
    return i18n.t(($) => $.researchTools.brief.hours, { count: minutes / 60 });
  }
  return i18n.t(($) => $.researchTools.brief.minutes, { count: minutes });
}

export interface BriefErrors {
  metric?: string;
  cost?: string;
  runs?: string;
}

/** What is wrong with a brief before it goes to the backend. */
export function briefErrors(brief: ResearchBrief): BriefErrors {
  const errors: BriefErrors = {};
  if (brief.primaryMetric && !METRIC_NAME.test(brief.primaryMetric.name)) {
    errors.metric = i18n.t(($) => $.researchTools.brief.invalidMetric);
  }
  const cap = brief.budget.usdCap;
  if (cap !== null && (!Number.isFinite(cap) || cap <= 0 || cap > 10_000)) {
    errors.cost = i18n.t(($) => $.researchTools.brief.invalidCost);
  }
  const runs = brief.budget.maxRuns;
  if (runs !== null && (!Number.isInteger(runs) || runs < 1 || runs > 1_000)) {
    errors.runs = i18n.t(($) => $.researchTools.brief.invalidRuns);
  }
  return errors;
}

/** `YYYY-MM-DDTHH:mm` in local time, for a datetime-local field. */
export function localDateTime(epochMs: number): string {
  const date = new Date(epochMs);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// The backend takes a start time up to a minute old and 30 days ahead.
const START_GRACE_MS = 60_000;
const START_AHEAD_MS = 30 * 24 * 60 * 60 * 1000;
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Epoch milliseconds of text such as `2026-10-24T14:30` (a space may stand in
 * for the T), or `NaN` when it isn't a real local date and time. A webview
 * without date and time fields shows a plain text box, so this is strict.
 */
export function parseLocalDateTime(text: string): number {
  const match = LOCAL_DATE_TIME.exec(text.trim());
  if (!match) return Number.NaN;
  const [year, month, day, hour, minute, second] = match.slice(1).map((part) => Number(part ?? 0));
  const date = new Date(year, month - 1, day, hour, minute, second);
  // 2026-02-31 would roll over into March; it is not a date.
  const real =
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day &&
    date.getHours() === hour &&
    date.getMinutes() === minute;
  return real ? date.getTime() : Number.NaN;
}

/** Why a start time can't be used (`NaN` is text that isn't a time), or `undefined` when it can. */
export function startError(runAfter: number | null, now = Date.now()): string | undefined {
  if (runAfter === null) return undefined;
  if (!Number.isFinite(runAfter)) {
    return i18n.t(($) => $.researchTools.brief.invalidStartFormat, { example: localDateTime(now + 24 * 60 * 60 * 1000) });
  }
  if (runAfter < now - START_GRACE_MS || runAfter > now + START_AHEAD_MS) {
    return i18n.t(($) => $.researchTools.brief.invalidStart);
  }
  return undefined;
}

/** A start time that has already passed means "start now". */
export function upcomingStart(runAfter: number | null | undefined, now = Date.now()): number | null {
  return typeof runAfter === "number" && Number.isFinite(runAfter) && runAfter > now ? runAfter : null;
}

/** Whether the webview draws date and time fields; without them the field is a plain text box. */
function supportsDateTimeInput(): boolean {
  if (typeof document === "undefined") return true;
  const input = document.createElement("input");
  input.type = "datetime-local";
  return input.type === "datetime-local";
}

/** Opens Settings on the Research section, where background work is turned on. */
function openResearchSettings() {
  useSettingsStore.getState().openSettingsAt("research");
}

function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : Number.NaN;
}

/** The choices, plus the saved value when it is not one of them. */
function optionsWith(options: number[], current: number): number[] {
  return options.includes(current) ? options : [...options, current].sort((a, b) => a - b);
}

/** What every field of the brief shares. */
interface FieldProps {
  brief: ResearchBrief;
  disabled: boolean;
  fieldId: (name: string) => string;
  update: (patch: Partial<ResearchBrief>) => void;
}

function MetricField({ brief, disabled, fieldId, update, error }: Readonly<FieldProps & { error?: string }>) {
  const { t } = useTranslation(["researchTools"]);
  return (
    <div className="grid gap-1.5">
      <label htmlFor={fieldId("metric")} className="text-xs font-medium">
        {t(($) => $.researchTools.brief.metricLabel)}
      </label>
      <div className="flex gap-2">
        <Input
          id={fieldId("metric")}
          className="min-w-0 flex-1"
          disabled={disabled}
          value={brief.primaryMetric?.name ?? ""}
          maxLength={64}
          placeholder={t(($) => $.researchTools.brief.metricPlaceholder)}
          aria-invalid={Boolean(error)}
          onChange={(event) => {
            const name = event.target.value.trim();
            update({
              primaryMetric: name
                ? { name, goal: brief.primaryMetric?.goal ?? "minimize" }
                : null,
            });
          }}
        />
        <Select
          value={brief.primaryMetric?.goal ?? "minimize"}
          disabled={disabled || !brief.primaryMetric}
          onValueChange={(goal) =>
            brief.primaryMetric &&
            update({ primaryMetric: { ...brief.primaryMetric, goal: goal as MetricGoal } })
          }
        >
          <SelectTrigger className="w-44" aria-label={t(($) => $.researchTools.brief.metricLabel)}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="minimize">{t(($) => $.researchTools.brief.metricMinimize)}</SelectItem>
            <SelectItem value="maximize">{t(($) => $.researchTools.brief.metricMaximize)}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

interface BudgetFieldsProps extends FieldProps {
  errors: BriefErrors;
  costText: string;
  onCostTextChange: (text: string) => void;
  runsText: string;
  onRunsTextChange: (text: string) => void;
}

function BudgetFields({
  brief,
  disabled,
  fieldId,
  update,
  errors,
  costText,
  onCostTextChange,
  runsText,
  onRunsTextChange,
}: Readonly<BudgetFieldsProps>) {
  const { t } = useTranslation(["researchTools"]);
  const updateBudget = (patch: Partial<ResearchBrief["budget"]>) =>
    update({ budget: { ...brief.budget, ...patch } });
  const timeOptions = optionsWith(TIME_BUDGET_OPTIONS, brief.budget.wallClockMinutes);
  const timeoutOptions = optionsWith(RUN_TIMEOUT_OPTIONS[brief.profile], brief.budget.runTimeoutMinutes);
  return (
    <fieldset className="grid gap-3">
      <legend className="mb-2 text-xs font-medium">{t(($) => $.researchTools.brief.budgetLabel)}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <label htmlFor={fieldId("time")} className="text-xs text-muted-foreground">
            {t(($) => $.researchTools.brief.timeLabel)}
          </label>
          <Select
            value={String(brief.budget.wallClockMinutes)}
            disabled={disabled}
            onValueChange={(value) => updateBudget({ wallClockMinutes: Number(value) })}
          >
            <SelectTrigger id={fieldId("time")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {timeOptions.map((minutes) => (
                <SelectItem key={minutes} value={String(minutes)}>
                  {durationLabel(minutes)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={fieldId("cost")} className="text-xs text-muted-foreground">
            {t(($) => $.researchTools.brief.costLabel)}
          </label>
          <Input
            id={fieldId("cost")}
            inputMode="decimal"
            disabled={disabled}
            value={costText}
            placeholder={t(($) => $.researchTools.brief.noLimit)}
            aria-invalid={Boolean(errors.cost)}
            onChange={(event) => {
              onCostTextChange(event.target.value);
              updateBudget({ usdCap: parseNumber(event.target.value) });
            }}
          />
          {errors.cost ? <p className="text-xs text-destructive">{errors.cost}</p> : null}
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={fieldId("runs")} className="text-xs text-muted-foreground">
            {t(($) => $.researchTools.brief.runsLabel)}
          </label>
          <Input
            id={fieldId("runs")}
            inputMode="numeric"
            disabled={disabled}
            value={runsText}
            placeholder={t(($) => $.researchTools.brief.noLimit)}
            aria-invalid={Boolean(errors.runs)}
            onChange={(event) => {
              onRunsTextChange(event.target.value);
              updateBudget({ maxRuns: parseNumber(event.target.value) });
            }}
          />
          {errors.runs ? <p className="text-xs text-destructive">{errors.runs}</p> : null}
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={fieldId("timeout")} className="text-xs text-muted-foreground">
            {t(($) => $.researchTools.brief.runTimeoutLabel)}
          </label>
          <Select
            value={String(brief.budget.runTimeoutMinutes)}
            disabled={disabled}
            onValueChange={(value) => updateBudget({ runTimeoutMinutes: Number(value) })}
          >
            <SelectTrigger id={fieldId("timeout")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {timeoutOptions.map((minutes) => (
                <SelectItem key={minutes} value={String(minutes)}>
                  {durationLabel(minutes)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </fieldset>
  );
}

interface ComputeFieldProps extends FieldProps {
  computeTargets: { id: string; label: string; executor: string }[];
  renderCompute?: (fieldId: string) => ReactNode;
}

function ComputeField({ brief, disabled, fieldId, update, computeTargets, renderCompute }: Readonly<ComputeFieldProps>) {
  const { t } = useTranslation(["researchTools"]);
  return (
    <div className="grid gap-1.5">
      <label htmlFor={fieldId("compute")} className="text-xs font-medium">
        {t(($) => $.researchTools.brief.computeLabel)}
      </label>
      {renderCompute ? (
        renderCompute(fieldId("compute"))
      ) : (
        <Select
          value={brief.compute.target ?? "local"}
          disabled={disabled || computeTargets.length === 0}
          onValueChange={(chosen) => {
            const target = computeTargets.find((item) => item.id === chosen);
            update({
              compute: target
                ? { executor: target.executor, target: target.id, resources: null }
                : { executor: "local", target: null, resources: null },
            });
          }}
        >
          <SelectTrigger id={fieldId("compute")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="local">{t(($) => $.researchTools.brief.computeLocal)}</SelectItem>
            {computeTargets.map((target) => (
              <SelectItem key={target.id} value={target.id}>
                {target.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

interface StartFieldProps {
  disabled: boolean;
  fieldId: (name: string) => string;
  runAfter: number | null;
  onRunAfterChange: (runAfter: number | null) => void;
  startText: string;
  onStartTextChange: (text: string) => void;
  /** The webview draws no date and time field, so the box takes typed text. */
  startAsText: boolean;
  startProblem: string | undefined;
  onDropDesktopApps: () => void;
}

function StartField({
  disabled,
  fieldId,
  runAfter,
  onRunAfterChange,
  startText,
  onStartTextChange,
  startAsText,
  startProblem,
  onDropDesktopApps,
}: Readonly<StartFieldProps>) {
  const { t } = useTranslation(["researchTools"]);
  return (
    <div className="grid gap-1.5">
      <label htmlFor={fieldId("start")} className="text-xs font-medium">
        {t(($) => $.researchTools.brief.startAtLabel)}
      </label>
      <Input
        id={fieldId("start")}
        type="datetime-local"
        disabled={disabled}
        value={startText}
        min={localDateTime(Date.now())}
        max={localDateTime(Date.now() + START_AHEAD_MS)}
        placeholder={localDateTime(Date.now() + 24 * 60 * 60 * 1000)}
        aria-invalid={Boolean(startProblem)}
        onChange={(event) => {
          const value = event.target.value;
          onStartTextChange(value);
          // Text that is not a time stays in the box; the composer sees `NaN` and won't save it.
          const next = value.trim() === "" ? null : parseLocalDateTime(value);
          if (next !== null && Number.isFinite(next)) onDropDesktopApps();
          onRunAfterChange(next);
        }}
      />
      {startProblem ? <p className="text-xs text-destructive">{startProblem}</p> : null}
      {startAsText && !startProblem ? (
        <p className="text-xs text-muted-foreground">
          {t(($) => $.researchTools.brief.startAtFormat, {
            example: localDateTime(Date.now() + 24 * 60 * 60 * 1000),
          })}
        </p>
      ) : null}
      {runAfter === null ? (
        <p className="text-xs text-muted-foreground">{t(($) => $.researchTools.brief.startNow)}</p>
      ) : null}
    </div>
  );
}

interface KeepRunningFieldProps {
  disabled: boolean;
  fieldId: (name: string) => string;
  keepRunning: boolean;
  onKeepRunningChange: (keepRunning: boolean) => void;
  backgroundEnabled: boolean;
  onDropDesktopApps: () => void;
}

function KeepRunningField({
  disabled,
  fieldId,
  keepRunning,
  onKeepRunningChange,
  backgroundEnabled,
  onDropDesktopApps,
}: Readonly<KeepRunningFieldProps>) {
  const { t } = useTranslation(["researchTools"]);
  return (
    <>
      <label htmlFor={fieldId("keep")} className="flex items-start gap-2 text-xs">
        <Checkbox
          id={fieldId("keep")}
          disabled={disabled || !backgroundEnabled}
          checked={keepRunning && backgroundEnabled}
          onCheckedChange={(next) => {
            if (next === true) onDropDesktopApps();
            onKeepRunningChange(next === true);
          }}
        />
        <span>
          <span className="font-medium">{t(($) => $.researchTools.brief.keepRunning)}</span>
          {!backgroundEnabled ? (
            <span className="block text-muted-foreground">{t(($) => $.researchTools.brief.keepRunningHint)}</span>
          ) : null}
        </span>
      </label>
      {!backgroundEnabled ? (
        <Button
          type="button"
          size="xs"
          variant="link"
          className="-mt-2 justify-start px-0"
          data-testid="research-brief-keep-running-settings"
          onClick={openResearchSettings}
        >
          {t(($) => $.researchTools.compute.brief.openSettings)}
        </Button>
      ) : null}
    </>
  );
}

interface BriefFieldsProps {
  brief: ResearchBrief;
  onChange: (brief: ResearchBrief) => void;
  runAfter: number | null;
  onRunAfterChange: (runAfter: number | null) => void;
  keepRunning: boolean;
  onKeepRunningChange: (keepRunning: boolean) => void;
  /** Background work is turned on in Settings, Research. */
  backgroundEnabled: boolean;
  disabled?: boolean;
  /** Extra compute targets (remote machines and clusters) and the executor each uses. */
  computeTargets?: { id: string; label: string; executor: string }[];
  /** Renders the whole "Run on" control (target, resources, notes) in place of the plain list. */
  renderCompute?: (fieldId: string) => ReactNode;
  /** The "Run on" choice has a problem the composer found (a removed target, a field that doesn't read). */
  computeProblem?: boolean;
}

export function BriefFields({
  brief,
  onChange,
  runAfter,
  onRunAfterChange,
  keepRunning,
  onKeepRunningChange,
  backgroundEnabled,
  disabled = false,
  computeTargets = [],
  renderCompute,
  computeProblem = false,
}: Readonly<BriefFieldsProps>) {
  const { t } = useTranslation(["researchTools"]);
  const id = useId();
  const errors = briefErrors(brief);
  const startProblem = startError(runAfter);
  const hasProblem = Object.keys(errors).length > 0 || startProblem !== undefined || computeProblem;
  // A saved draft can hold a bad value, so the options open on the problem.
  const [open, setOpen] = useState(hasProblem);
  const [startText, setStartText] = useState(() =>
    runAfter !== null && Number.isFinite(runAfter) ? localDateTime(runAfter) : "",
  );
  const [startAsText] = useState(() => !supportsDateTimeInput());
  const [criteriaText, setCriteriaText] = useState(() => brief.successCriteria.join("\n"));
  const [costText, setCostText] = useState(() => brief.budget.usdCap?.toString() ?? "");
  const [runsText, setRunsText] = useState(() => brief.budget.maxRuns?.toString() ?? "");
  const update = (patch: Partial<ResearchBrief>) => onChange({ ...brief, ...patch });
  // Desktop apps need someone at the computer to approve each action, so a
  // task that starts on a schedule or outlives the app gives them up.
  const unattended = runAfter !== null || (keepRunning && backgroundEnabled);
  const dropDesktopApps = () => {
    if (brief.permissions.desktopApps) {
      update({ permissions: { ...brief.permissions, desktopApps: false } });
    }
  };
  const fieldId = (name: string) => `${id}-${name}`;
  const field: FieldProps = { brief, disabled, fieldId, update };

  return (
    <div className="grid gap-4" data-testid="research-brief-fields">
      <div className="grid gap-1.5">
        <label htmlFor={fieldId("goal")} className="text-xs font-medium">
          {t(($) => $.researchTools.brief.goalLabel)}
        </label>
        <Textarea
          id={fieldId("goal")}
          disabled={disabled}
          value={brief.goal}
          maxLength={2_000}
          rows={2}
          placeholder={t(($) => $.researchTools.brief.goalPlaceholder)}
          onChange={(event) => update({ goal: event.target.value })}
        />
      </div>

      <div className="grid gap-1.5">
        <label htmlFor={fieldId("criteria")} className="text-xs font-medium">
          {t(($) => $.researchTools.brief.criteriaLabel)}
        </label>
        <Textarea
          id={fieldId("criteria")}
          disabled={disabled}
          value={criteriaText}
          rows={3}
          onChange={(event) => {
            setCriteriaText(event.target.value);
            update({
              successCriteria: event.target.value
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean)
                .slice(0, 12)
                .map((line) => line.slice(0, 500)),
            });
          }}
        />
        <p className="text-xs text-muted-foreground">{t(($) => $.researchTools.brief.criteriaHint)}</p>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="justify-start gap-1 px-1 text-muted-foreground"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        data-testid="research-brief-more"
      >
        {open ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
        {t(($) => $.researchTools.brief.title)}
      </Button>
      {!open && hasProblem ? (
        <p role="alert" className="text-xs text-destructive" data-testid="research-brief-problem">
          {t(($) => $.researchTools.brief.problemHidden)}
        </p>
      ) : null}

      {open ? (
        <div className="grid gap-4 border-l pl-3">
          <div className="grid gap-1.5">
            <label htmlFor={fieldId("scope")} className="text-xs font-medium">
              {t(($) => $.researchTools.brief.scopeLabel)}
            </label>
            <Input
              id={fieldId("scope")}
              disabled={disabled}
              value={brief.scope}
              maxLength={2_000}
              onChange={(event) => update({ scope: event.target.value })}
            />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor={fieldId("constraints")} className="text-xs font-medium">
              {t(($) => $.researchTools.brief.constraintsLabel)}
            </label>
            <Textarea
              id={fieldId("constraints")}
              disabled={disabled}
              value={brief.constraints}
              maxLength={2_000}
              rows={2}
              onChange={(event) => update({ constraints: event.target.value })}
            />
          </div>

          <MetricField {...field} error={errors.metric} />

          <label htmlFor={fieldId("plan")} className="flex items-start gap-2 text-xs">
            <Checkbox
              id={fieldId("plan")}
              disabled={disabled}
              checked={brief.reviewPlanFirst}
              onCheckedChange={(next) => update({ reviewPlanFirst: next === true })}
            />
            <span>
              <span className="font-medium">{t(($) => $.researchTools.brief.reviewPlan)}</span>
              <span className="block text-muted-foreground">{t(($) => $.researchTools.brief.reviewPlanHint)}</span>
            </span>
          </label>

          <div className="grid gap-1.5">
            <label htmlFor={fieldId("commands")} className="text-xs font-medium">
              {t(($) => $.researchTools.brief.commandsLabel)}
            </label>
            <Select
              value={brief.permissions.commands}
              disabled={disabled}
              onValueChange={(commands) =>
                update({ permissions: { ...brief.permissions, commands: commands as CommandPolicy } })
              }
            >
              <SelectTrigger id={fieldId("commands")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="allow">{t(($) => $.researchTools.brief.commandsAllow)}</SelectItem>
                <SelectItem value="ask">{t(($) => $.researchTools.brief.commandsAsk)}</SelectItem>
                <SelectItem value="off">{t(($) => $.researchTools.brief.commandsOff)}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <label htmlFor={fieldId("network")} className="flex items-start gap-2 text-xs">
            <Checkbox
              id={fieldId("network")}
              disabled={disabled || brief.permissions.commands === "off"}
              checked={brief.permissions.network}
              onCheckedChange={(next) =>
                update({ permissions: { ...brief.permissions, network: next === true } })
              }
            />
            <span>
              <span className="font-medium">{t(($) => $.researchTools.brief.network)}</span>
              <span className="block text-muted-foreground">{t(($) => $.researchTools.brief.networkHint)}</span>
            </span>
          </label>

          <DesktopAppsBriefField
            id={fieldId("desktop-apps")}
            disabled={disabled}
            unattended={unattended}
            checked={brief.permissions.desktopApps}
            onCheckedChange={(desktopApps) => update({ permissions: { ...brief.permissions, desktopApps } })}
          />

          <BudgetFields
            {...field}
            errors={errors}
            costText={costText}
            onCostTextChange={setCostText}
            runsText={runsText}
            onRunsTextChange={setRunsText}
          />

          <div className="grid gap-1.5">
            <label htmlFor={fieldId("profile")} className="text-xs font-medium">
              {t(($) => $.researchTools.brief.profileLabel)}
            </label>
            <Select
              value={brief.profile}
              disabled={disabled}
              onValueChange={(value) => {
                const profile = value as RunProfile;
                const options = RUN_TIMEOUT_OPTIONS[profile];
                const timeout = options.includes(brief.budget.runTimeoutMinutes)
                  ? brief.budget.runTimeoutMinutes
                  : options[Math.min(2, options.length - 1)];
                onChange({ ...brief, profile, budget: { ...brief.budget, runTimeoutMinutes: timeout } });
              }}
            >
              <SelectTrigger id={fieldId("profile")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="analysis">{t(($) => $.researchTools.brief.profileAnalysis)}</SelectItem>
                <SelectItem value="training">{t(($) => $.researchTools.brief.profileTraining)}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {brief.profile === "training"
                ? t(($) => $.researchTools.brief.profileTrainingHint)
                : t(($) => $.researchTools.brief.profileAnalysisHint)}
            </p>
          </div>

          <ComputeField {...field} computeTargets={computeTargets} renderCompute={renderCompute} />

          <StartField
            disabled={disabled}
            fieldId={fieldId}
            runAfter={runAfter}
            onRunAfterChange={onRunAfterChange}
            startText={startText}
            onStartTextChange={setStartText}
            startAsText={startAsText}
            startProblem={startProblem}
            onDropDesktopApps={dropDesktopApps}
          />

          <KeepRunningField
            disabled={disabled}
            fieldId={fieldId}
            keepRunning={keepRunning}
            onKeepRunningChange={onKeepRunningChange}
            backgroundEnabled={backgroundEnabled}
            onDropDesktopApps={dropDesktopApps}
          />
        </div>
      ) : null}
    </div>
  );
}
