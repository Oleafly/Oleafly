import * as React from 'react';
import type { EventWithOptionalKeyState, IncrementValueParameters } from "../utils/types.js";
import type { NumberFieldRoot } from "./NumberFieldRoot.js";
export declare function useNumberFieldButton(params: UseNumberFieldButtonParameters): React.DetailedHTMLProps<React.ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement>;
export interface UseNumberFieldButtonParameters {
  allowInputSyncRef: React.RefObject<boolean | null>;
  disabled: boolean;
  formatOptionsRef: React.RefObject<Intl.NumberFormatOptions | undefined>;
  getStepAmount: (event?: EventWithOptionalKeyState) => number;
  id: string | undefined;
  incrementValue: (amount: number, params: IncrementValueParameters) => boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  inputValue: string;
  isIncrement: boolean;
  locale?: Intl.LocalesArgument | undefined;
  readOnly: boolean;
  setValue: (value: number | null, details: NumberFieldRoot.ChangeEventDetails) => boolean;
  valueRef: React.RefObject<number | null>;
  lastChangedValueRef: React.RefObject<number | null>;
  onValueCommitted: (value: number | null, eventDetails: NumberFieldRoot.CommitEventDetails) => void;
}