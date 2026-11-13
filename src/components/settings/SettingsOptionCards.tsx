import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SettingsOptionCard<T extends string> {
  id: T;
  label: string;
  preview: ReactNode;
}

const COLUMNS = {
  3: "grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
} as const;

export function SettingsOptionCards<T extends string>({
  label,
  description,
  value,
  options,
  onChange,
  columns = 3,
  adornment,
  testId,
  optionTestId,
}: Readonly<{
  label: string;
  description: string;
  value: T;
  options: readonly SettingsOptionCard<T>[];
  onChange: (value: T) => void;
  columns?: keyof typeof COLUMNS;
  adornment?: ReactNode;
  testId?: string;
  optionTestId?: (id: T) => string;
}>) {
  const labelId = useId();
  return (
    <div data-testid={testId} className="rounded-lg border bg-card p-3">
      <div className="mb-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div id={labelId} className="text-sm font-medium">
            {label}
          </div>
          <div className="text-xs text-muted-foreground">{description}</div>
        </div>
        {adornment}
      </div>
      <fieldset aria-labelledby={labelId} className={cn("m-0 grid min-w-0 gap-2 border-0 p-0", COLUMNS[columns])}>
        {options.map((option) => {
          const active = value === option.id;
          return (
            <button
              type="button"
              key={option.id}
              data-testid={optionTestId?.(option.id)}
              aria-pressed={active}
              onClick={() => onChange(option.id)}
              className={cn(
                "flex min-w-0 flex-col items-center gap-2 rounded-md border p-3 text-center text-xs font-medium break-words transition-colors motion-reduce:transition-none",
                active ? "border-primary bg-primary/5 focus-visible:bg-primary/15" : "border-border hover:bg-accent focus-visible:bg-accent",
              )}
            >
              {option.preview}
              {option.label}
            </button>
          );
        })}
      </fieldset>
    </div>
  );
}
