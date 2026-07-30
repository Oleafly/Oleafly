'use client';

import _formatErrorMessage from "@base-ui/utils/formatErrorMessage";
import * as React from 'react';
import { EMPTY_OBJECT } from '@base-ui/utils/empty';
import { NOOP } from "../noop.mjs";
import { DEFAULT_FIELD_ROOT_STATE, DEFAULT_FIELD_STATE_ATTRIBUTES, DEFAULT_VALIDITY_STATE } from "../field-constants/constants.mjs";
export const DEFAULT_FIELD_ROOT_CONTEXT = {
  invalid: undefined,
  name: undefined,
  validityData: {
    state: DEFAULT_VALIDITY_STATE,
    errors: [],
    error: '',
    value: '',
    initialValue: null
  },
  setValidityData: NOOP,
  disabled: undefined,
  touched: DEFAULT_FIELD_STATE_ATTRIBUTES.touched,
  setTouched: NOOP,
  dirty: DEFAULT_FIELD_STATE_ATTRIBUTES.dirty,
  setDirty: NOOP,
  filled: DEFAULT_FIELD_STATE_ATTRIBUTES.filled,
  setFilled: NOOP,
  focused: DEFAULT_FIELD_STATE_ATTRIBUTES.focused,
  setFocused: NOOP,
  validate: () => null,
  validationMode: 'onSubmit',
  validationDebounceTime: 0,
  shouldValidateOnChange: () => false,
  state: DEFAULT_FIELD_ROOT_STATE,
  markedDirtyRef: {
    current: false
  },
  registerFieldControl: NOOP,
  validation: {
    getValidationProps: (_disabled, props = EMPTY_OBJECT) => props,
    inputRef: {
      current: null
    },
    registerInput: NOOP,
    commit: async () => {},
    change: NOOP
  }
};
export const FieldRootContext = /*#__PURE__*/React.createContext(DEFAULT_FIELD_ROOT_CONTEXT);
if (process.env.NODE_ENV !== "production") FieldRootContext.displayName = "FieldRootContext";
export function useFieldRootContext(optional = true) {
  const context = React.useContext(FieldRootContext);
  if (context.setValidityData === NOOP && !optional) {
    throw new Error(process.env.NODE_ENV !== "production" ? 'Base UI: FieldRootContext is missing. Field parts must be placed within <Field.Root>.' : _formatErrorMessage(28));
  }
  return context;
}