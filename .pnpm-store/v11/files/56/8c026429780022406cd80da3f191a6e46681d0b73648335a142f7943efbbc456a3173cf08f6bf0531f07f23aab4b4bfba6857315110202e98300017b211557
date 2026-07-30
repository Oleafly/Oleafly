import * as React from 'react';
import type { UseFieldValidationReturnValue } from "../field/root/useFieldValidation.mjs";
import type { UseCheckboxGroupParentReturnValue } from "./useCheckboxGroupParent.mjs";
import type { BaseUIChangeEventDetails } from "../internals/createBaseUIEventDetails.mjs";
import type { BaseUIEventReasons } from "../internals/reasons.mjs";
export interface CheckboxGroupContext {
  value: string[] | undefined;
  defaultValue: string[] | undefined;
  setValue: (value: string[], eventDetails: BaseUIChangeEventDetails<BaseUIEventReasons['none']>) => void;
  allValues: string[] | undefined;
  parent: UseCheckboxGroupParentReturnValue;
  disabled: boolean;
  validation: UseFieldValidationReturnValue;
  registerControlRef: (element: HTMLButtonElement | null) => void;
}
export declare const CheckboxGroupContext: React.Context<CheckboxGroupContext | undefined>;
export declare function useCheckboxGroupContext(optional: false): CheckboxGroupContext;
export declare function useCheckboxGroupContext(optional?: true): CheckboxGroupContext | undefined;