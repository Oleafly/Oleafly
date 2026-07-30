import * as React from 'react';
import type { Form } from "../../form/index.js";
import type { HTMLProps } from "../../internals/types.js";
import type { FieldValidityData, FieldRootState } from "./FieldRoot.js";
export declare function useFieldValidation(params: UseFieldValidationParameters): UseFieldValidationReturnValue;
export interface UseFieldValidationParameters {
  setValidityData: (data: FieldValidityData) => void;
  validate: (value: unknown, formValues: Form.Values) => string | string[] | null | Promise<string | string[] | null>;
  validityData: FieldValidityData;
  validationDebounceTime: number;
  invalid: boolean;
  markedDirtyRef: React.RefObject<boolean>;
  state: FieldRootState;
  shouldValidateOnChange: () => boolean;
  getRegisteredFieldId: () => string | undefined;
}
export interface UseFieldValidationReturnValue {
  getValidationProps: (disabled: boolean, props?: HTMLProps) => HTMLProps;
  inputRef: React.RefObject<HTMLInputElement | null>;
  registerInput: React.RefCallback<HTMLInputElement>;
  commit: (value: unknown) => Promise<void>;
  change: (value: unknown) => void;
}