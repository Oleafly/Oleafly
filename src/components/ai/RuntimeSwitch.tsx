import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  selectScopeRuntime,
  useAssistantRuntimeStore,
  WORKSPACE_RUNTIME_SCOPE,
  type AssistantRuntime,
} from "@/store/assistant-runtime";
import { cn } from "@/lib/utils";

const RUNTIMES: ReadonlyArray<{
  value: AssistantRuntime;
  labelKey: "builtIn" | "cli";
}> = [
  { value: "built-in", labelKey: "builtIn" },
  { value: "acp", labelKey: "cli" },
];

export function RuntimeSwitch({ scope = WORKSPACE_RUNTIME_SCOPE }: Readonly<{ scope?: string }>) {
  const { t } = useTranslation(["common", "ai"]);
  const runtime = useAssistantRuntimeStore(useMemo(() => selectScopeRuntime(scope), [scope]));
  const setScopeRuntime = useAssistantRuntimeStore((state) => state.setScopeRuntime);
  const labels = {
    builtIn: t(($) => $.ai.runtime.builtIn),
    cli: t(($) => $.ai.runtime.cli),
  };
  return (
    <fieldset
      data-tour={scope === WORKSPACE_RUNTIME_SCOPE ? "assistant-runtime" : undefined}
      className="flex shrink-0 items-center rounded-md bg-muted p-0.5"
      aria-label={t(($) => $.ai.runtime.ariaLabel)}
    >
      {RUNTIMES.map(({ value, labelKey }) => (
        <button
          key={value}
          type="button"
          aria-label={labels[labelKey]}
          aria-pressed={runtime === value}
          onClick={() => setScopeRuntime(scope, value)}
          className={cn(
            "flex items-center gap-1 whitespace-nowrap rounded px-2 py-1 text-xs leading-4 transition-colors",
            runtime === value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <span>{labels[labelKey]}</span>
        </button>
      ))}
    </fieldset>
  );
}
