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
  automatic?: FontSizeAutomatic;
}

export type FontSizeAutomatic = Readonly<{ label: string; value: number; size: number }>;

const CUSTOM = "custom";

function chosenOption(
  value: number,
  presets: readonly number[],
  automatic: FontSizeAutomatic | undefined,
  customChosen: boolean,
): string {
  if (customChosen) return CUSTOM;
  if (value === automatic?.value) return String(value);
  return presets.includes(value) ? String(value) : CUSTOM;
}

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
  automatic,
}: Readonly<FontSizeControlProps>) {
  const { t } = useTranslation(["settings"]);
  const [customChosen, setCustomChosen] = useState(false);
  const choice = chosenOption(value, presets, automatic, customChosen);
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
        <SelectTrigger className={automatic ? "w-[168px]" : "w-[112px]"} aria-label={ariaLabel} data-testid={triggerTestId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="z-[100]">
          {automatic ? <SelectItem value={String(automatic.value)}>{automatic.label}</SelectItem> : null}
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
          value={value === automatic?.value ? automatic.size : value}
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
