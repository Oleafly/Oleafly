type NumberFormatOptionsWithRounding = Intl.NumberFormatOptions & {
  roundingIncrement?: number | undefined;
  roundingMode?: string | undefined;
  roundingPriority?: string | undefined;
};
export declare function hasNumberFormatRoundingOptions(format?: NumberFormatOptionsWithRounding): format is NumberFormatOptionsWithRounding;
export declare function removeFloatingPointErrors(value: number, format?: NumberFormatOptionsWithRounding): number;
export declare function toValidatedNumber(value: number | null, {
  step,
  minWithDefault,
  maxWithDefault,
  minWithZeroDefault,
  format,
  snapOnStep,
  small,
  clamp: shouldClamp
}: {
  step: number | undefined;
  minWithDefault: number;
  maxWithDefault: number;
  minWithZeroDefault: number;
  format: NumberFormatOptionsWithRounding | undefined;
  snapOnStep: boolean;
  small: boolean;
  clamp: boolean;
}): number | null;
export {};