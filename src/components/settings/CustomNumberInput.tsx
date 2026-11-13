import { useEffect, useState } from "react";
import { isImeEnter } from "@/components/ai/composer/ime";
import { Input } from "@/components/ui/input";

export function CustomNumberInput({
  value,
  onCommit,
  range,
  clamp,
  ariaLabel,
  testId,
  disabled = false,
}: Readonly<{
  value: number;
  onCommit: (value: number) => void;
  range: Readonly<{ min: number; max: number; step: number }>;
  clamp: (value: number) => number;
  ariaLabel: string;
  testId: string;
  disabled?: boolean;
}>) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft((current) => (Number(current) === value ? current : String(value)));
  }, [value]);

  const commit = () => {
    const typed = Number(draft);
    const next = draft.trim() === "" || !Number.isFinite(typed) ? value : clamp(typed);
    onCommit(next);
    setDraft(String(next));
  };

  return (
    <Input
      type="number"
      inputMode="decimal"
      min={range.min}
      max={range.max}
      step={range.step}
      aria-label={ariaLabel}
      data-testid={testId}
      disabled={disabled}
      className="h-9 w-[76px]"
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
        const typed = Number(event.target.value);
        if (event.target.value.trim() !== "" && Number.isFinite(typed) && typed >= range.min && typed <= range.max) {
          onCommit(typed);
        }
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || isImeEnter(event)) return;
        event.preventDefault();
        commit();
      }}
    />
  );
}
