import { useTranslation } from "react-i18next";
import {
  selectActiveRuntime,
  useAssistantRuntimeStore,
  type AssistantRuntime,
} from "@/store/assistant-runtime";
import { BetaBadge } from "@/components/ui/beta-badge";
import { cn } from "@/lib/utils";

const RUNTIMES: ReadonlyArray<{
  value: AssistantRuntime;
  labelKey: "builtIn" | "cli";
  beta?: boolean;
}> = [
  { value: "built-in", labelKey: "builtIn" },
  { value: "acp", labelKey: "cli", beta: true },
];

export function RuntimeSwitch() {
  const { t } = useTranslation(["common", "ai"]);
  const runtime = useAssistantRuntimeStore(selectActiveRuntime);
  const setRuntime = useAssistantRuntimeStore((state) => state.setRuntime);
  const labels = {
    builtIn: t(($) => $.ai.runtime.builtIn),
    cli: t(($) => $.ai.runtime.cli),
  };
  return (
    <fieldset
      data-tour="assistant-runtime"
      className="flex shrink-0 items-center rounded-md bg-muted p-0.5"
      aria-label={t(($) => $.ai.runtime.ariaLabel)}
    >
      {RUNTIMES.map(({ value, labelKey, beta }) => (
        <button
          key={value}
          type="button"
          aria-label={labels[labelKey]}
          aria-pressed={runtime === value}
          onClick={() => setRuntime(value)}
          className={cn(
            "flex items-center gap-1 whitespace-nowrap rounded px-2 py-1 text-xs leading-4 transition-colors",
            runtime === value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <span>{labels[labelKey]}</span>
          {beta ? <BetaBadge className="leading-[13px]" /> : null}
        </button>
      ))}
    </fieldset>
  );
}
