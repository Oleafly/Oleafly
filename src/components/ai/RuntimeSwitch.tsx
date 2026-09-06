import {
  selectActiveRuntime,
  useAssistantRuntimeStore,
  type AssistantRuntime,
} from "@/store/assistant-runtime";
import { cn } from "@/lib/utils";

const RUNTIMES: ReadonlyArray<readonly [AssistantRuntime, string]> = [
  ["built-in", "Oleafly"],
  ["acp", "CLI agents"],
];

export function RuntimeSwitch() {
  const runtime = useAssistantRuntimeStore(selectActiveRuntime);
  const setRuntime = useAssistantRuntimeStore((state) => state.setRuntime);
  return (
    <fieldset
      className="flex shrink-0 items-center rounded-md bg-muted p-0.5"
      aria-label="Assistant runtime"
    >
      {RUNTIMES.map(([value, label]) => (
        <button
          key={value}
          type="button"
          aria-pressed={runtime === value}
          onClick={() => setRuntime(value)}
          className={cn(
            "whitespace-nowrap rounded px-2 py-1 text-xs leading-4 transition-colors",
            runtime === value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </fieldset>
  );
}
