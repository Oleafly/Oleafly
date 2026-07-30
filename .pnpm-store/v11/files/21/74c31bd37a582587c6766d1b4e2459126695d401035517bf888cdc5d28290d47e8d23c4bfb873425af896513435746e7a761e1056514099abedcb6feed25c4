'use client';

import * as React from 'react';
import { NOOP } from "../noop.mjs";
export const FormContext = /*#__PURE__*/React.createContext({
  formRef: {
    current: {
      fields: new Map()
    }
  },
  errors: {},
  clearErrors: NOOP,
  validationMode: 'onSubmit',
  submitAttemptedRef: {
    current: false
  }
});
if (process.env.NODE_ENV !== "production") FormContext.displayName = "FormContext";
export function useFormContext() {
  return React.useContext(FormContext);
}