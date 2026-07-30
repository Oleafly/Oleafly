import * as React from 'react';
import type { BaseUIChangeEventDetails } from "../internals/createBaseUIEventDetails.js";
import type { BaseUIEventReasons } from "../internals/reasons.js";
export declare function useCheckboxGroupParent(params: UseCheckboxGroupParentParameters): UseCheckboxGroupParentReturnValue;
export interface UseCheckboxGroupParentParameters {
  allValues?: string[] | undefined;
  value?: string[] | undefined;
  onValueChange?: ((value: string[], eventDetails: BaseUIChangeEventDetails<BaseUIEventReasons['none']>) => void) | undefined;
}
export interface UseCheckboxGroupParentReturnValue {
  id: string | undefined;
  indeterminate: boolean;
  disabledStatesRef: React.RefObject<Map<string, boolean>>;
  getParentProps: () => {
    id: string | undefined;
    indeterminate: boolean;
    checked: boolean;
    'aria-controls': string;
    onCheckedChange: (checked: boolean, eventDetails: BaseUIChangeEventDetails<BaseUIEventReasons['none']>) => void;
  };
  getChildProps: (value: string) => {
    checked: boolean;
    onCheckedChange: (checked: boolean, eventDetails: BaseUIChangeEventDetails<BaseUIEventReasons['none']>) => void;
  };
}
export interface UseCheckboxGroupParentState {}