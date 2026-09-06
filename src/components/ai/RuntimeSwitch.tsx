import {
  selectActiveRuntime,
  useAssistantRuntimeStore,
  type AssistantRuntime,
} from "@/store/assistant-runtime";
import { BetaBadge } from "@/components/ui/beta-badge";
import { cn } from "@/lib/utils";

const RUNTIMES: ReadonlyArray<{
  value: AssistantRuntime;
  label: string;
  beta?: boolean;
}> = [
  { value: "built-in", label: "Oleafly Agent" },
  { value: "acp", label: "CLI Agent", beta: true },
];

export function RuntimeSwitch() {
  const runtime = useAssistantRuntimeStore(selectActiveRuntime);
  const setRuntime = useAssistantRuntimeStore((state) => state.setRuntime);
  return (
    <fieldset
      data-tour="assistant-runtime"
      className="flex shrink-0 items-center rounded-md bg-muted p-0.5"
      aria-label="Assistant runtime"
    >
      {RUNTIMES.map(({ value, label, beta }) => (
        <button
          key={value}
          type="button"
          aria-label={label}
          aria-pressed={runtime === value}
          onClick={() => setRuntime(value)}
          className={cn(
            "flex items-center gap-1 whitespace-nowrap rounded px-2 py-1 text-xs leading-4 transition-colors",
            runtime === value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <span>{label}</span>
          {beta ? <BetaBadge className="leading-[13px]" /> : null}
        </button>
      ))}
    </fieldset>
  );
}
