import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CustomNumberInput } from "@/components/settings/CustomNumberInput";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface FontSizeControlProps {
  value: number;
  onChange: (size: number) => void;
  presets: readonly number[];
  range: Readonly<{ min: number; max: number; step: number }>;
  clamp: (value: number) => number;
  customOption: string;
  customLabel: string;
  triggerTestId: string;
  customTestId: string;
  ariaLabel?: string;
  disabled?: boolean;
}

const CUSTOM = "custom";

export function FontSizeControl({
  value,
  onChange,
  presets,
  range,
  clamp,
  customOption,
  customLabel,
  triggerTestId,
  customTestId,
  ariaLabel,
  disabled = false,
}: Readonly<FontSizeControlProps>) {
  const { t } = useTranslation(["settings"]);
  const [customChosen, setCustomChosen] = useState(false);
  const choice = customChosen || !presets.includes(value) ? CUSTOM : String(value);
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Select
        disabled={disabled}
        value={choice}
        onValueChange={(next) => {
          setCustomChosen(next === CUSTOM);
          if (next !== CUSTOM) onChange(Number(next));
        }}
      >
        <SelectTrigger className="w-[112px]" aria-label={ariaLabel} data-testid={triggerTestId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="z-[100]">
          {presets.map((option) => (
            <SelectItem key={option} value={String(option)}>
              {t(($) => $.settings.appearance.fontSizeOption, { size: option })}
            </SelectItem>
          ))}
          <SelectItem value={CUSTOM}>{customOption}</SelectItem>
        </SelectContent>
      </Select>
      {choice === CUSTOM ? (
        <CustomNumberInput
          value={value}
          onCommit={onChange}
          range={range}
          clamp={clamp}
          ariaLabel={customLabel}
          testId={customTestId}
          disabled={disabled}
        />
      ) : null}
    </div>
  );
}
