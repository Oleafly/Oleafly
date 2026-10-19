import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
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

function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : Number.NaN;
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
}: Readonly<BriefFieldsProps>) {
  const { t } = useTranslation(["researchTools"]);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [criteriaText, setCriteriaText] = useState(() => brief.successCriteria.join("\n"));
  const [costText, setCostText] = useState(() => brief.budget.usdCap?.toString() ?? "");
  const [runsText, setRunsText] = useState(() => brief.budget.maxRuns?.toString() ?? "");
  const errors = briefErrors(brief);
  const update = (patch: Partial<ResearchBrief>) => onChange({ ...brief, ...patch });
  // Desktop apps need someone at the computer to approve each action, so a
  // task that starts on a schedule or outlives the app gives them up.
  const unattended = runAfter !== null || (keepRunning && backgroundEnabled);
  const dropDesktopApps = () => {
    if (brief.permissions.desktopApps) {
      update({ permissions: { ...brief.permissions, desktopApps: false } });
    }
  };
  const updateBudget = (patch: Partial<ResearchBrief["budget"]>) =>
    update({ budget: { ...brief.budget, ...patch } });
  const timeOptions = TIME_BUDGET_OPTIONS.includes(brief.budget.wallClockMinutes)
    ? TIME_BUDGET_OPTIONS
    : [...TIME_BUDGET_OPTIONS, brief.budget.wallClockMinutes].sort((a, b) => a - b);
  const timeoutOptions = RUN_TIMEOUT_OPTIONS[brief.profile].includes(brief.budget.runTimeoutMinutes)
    ? RUN_TIMEOUT_OPTIONS[brief.profile]
    : [...RUN_TIMEOUT_OPTIONS[brief.profile], brief.budget.runTimeoutMinutes].sort((a, b) => a - b);
  const fieldId = (name: string) => `${id}-${name}`;

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

      <button
        type="button"
        className="flex items-center gap-1 rounded-md px-1 py-0.5 text-left text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:bg-muted"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        data-testid="research-brief-more"
      >
        {open ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
        {t(($) => $.researchTools.brief.title)}
      </button>

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
                aria-invalid={Boolean(errors.metric)}
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
            {errors.metric ? <p className="text-xs text-destructive">{errors.metric}</p> : null}
          </div>

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
                    setCostText(event.target.value);
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
                    setRunsText(event.target.value);
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

          <div className="grid gap-1.5">
            <label htmlFor={fieldId("start")} className="text-xs font-medium">
              {t(($) => $.researchTools.brief.startAtLabel)}
            </label>
            <Input
              id={fieldId("start")}
              type="datetime-local"
              disabled={disabled}
              value={runAfter === null ? "" : localDateTime(runAfter)}
              min={localDateTime(Date.now())}
              onChange={(event) => {
                const value = event.target.value;
                const at = value ? new Date(value).getTime() : Number.NaN;
                const next = Number.isFinite(at) ? at : null;
                if (next !== null) dropDesktopApps();
                onRunAfterChange(next);
              }}
            />
            {runAfter === null ? (
              <p className="text-xs text-muted-foreground">{t(($) => $.researchTools.brief.startNow)}</p>
            ) : null}
          </div>

          <label htmlFor={fieldId("keep")} className="flex items-start gap-2 text-xs">
            <Checkbox
              id={fieldId("keep")}
              disabled={disabled || !backgroundEnabled}
              checked={keepRunning && backgroundEnabled}
              onCheckedChange={(next) => {
                if (next === true) dropDesktopApps();
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
        </div>
      ) : null}
    </div>
  );
}
