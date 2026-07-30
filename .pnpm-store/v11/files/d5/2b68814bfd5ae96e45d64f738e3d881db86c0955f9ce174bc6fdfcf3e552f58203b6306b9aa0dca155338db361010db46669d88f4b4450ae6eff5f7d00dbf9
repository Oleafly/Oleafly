'use client';

import * as React from 'react';
import { useStableCallback } from '@base-ui/utils/useStableCallback';
import { EMPTY_OBJECT } from '@base-ui/utils/empty';
import { createGenericEventDetails } from "../internals/createBaseUIEventDetails.mjs";
import { REASONS } from "../internals/reasons.mjs";
import { FormContext } from "../internals/form-context/FormContext.mjs";
import { useRenderElement } from "../internals/useRenderElement.mjs";
import { useValueChanged } from "../internals/useValueChanged.mjs";

/**
 * A native form element with consolidated error handling.
 * Renders a `<form>` element.
 *
 * Documentation: [Base UI Form](https://base-ui.com/react/components/form)
 */
import { jsx as _jsx } from "react/jsx-runtime";
export const Form = /*#__PURE__*/React.forwardRef(function Form(componentProps, forwardedRef) {
  const {
    render,
    className,
    validationMode = 'onSubmit',
    errors: externalErrors,
    onSubmit,
    onFormSubmit,
    actionsRef,
    style,
    ...elementProps
  } = componentProps;
  const formRef = React.useRef({
    fields: new Map()
  });
  const submittedRef = React.useRef(false);
  const submitAttemptedRef = React.useRef(false);
  const focusControl = useStableCallback(control => {
    if (!control) {
      return;
    }
    control.focus();
    if (control.tagName === 'INPUT') {
      control.select();
    }
  });
  const [errors, setErrors] = React.useState(externalErrors);
  useValueChanged(externalErrors, () => {
    setErrors(externalErrors);
  });
  React.useEffect(() => {
    if (!submittedRef.current) {
      return;
    }
    submittedRef.current = false;
    const invalidFields = Array.from(formRef.current.fields.values()).filter(field => field.validityData.state.valid === false);
    if (invalidFields.length) {
      focusControl(invalidFields[0].controlRef.current);
    }
  }, [errors, focusControl]);
  const handleImperativeValidate = React.useCallback(fieldName => {
    const values = Array.from(formRef.current.fields.values());
    if (fieldName) {
      const namedField = values.find(field => field.name === fieldName);
      if (namedField) {
        namedField.validate();
      }
    } else {
      values.forEach(field => {
        field.validate();
      });
    }
  }, []);
  React.useImperativeHandle(actionsRef, () => ({
    validate: handleImperativeValidate
  }), [handleImperativeValidate]);
  const element = useRenderElement('form', componentProps, {
    ref: forwardedRef,
    props: [{
      noValidate: true,
      onSubmit(event) {
        submitAttemptedRef.current = true;
        let values = Array.from(formRef.current.fields.values());

        // Async validation isn't supported to stop the submit event.
        values.forEach(field => {
          field.validate();
        });
        values = Array.from(formRef.current.fields.values());
        const invalidField = values.find(field => field.validityData.state.valid === false);
        if (invalidField) {
          event.preventDefault();
          focusControl(invalidField.controlRef.current);
        } else {
          submittedRef.current = true;
          onSubmit?.(event);
          if (onFormSubmit) {
            event.preventDefault();
            const formValues = values.reduce((acc, field) => {
              if (field.name) {
                acc[field.name] = field.getValue();
              }
              return acc;
            }, {});
            onFormSubmit(formValues, createGenericEventDetails(REASONS.none, event.nativeEvent));
          }
        }
      }
    }, elementProps]
  });
  const clearErrors = useStableCallback(name => {
    if (name && errors && EMPTY_OBJECT.hasOwnProperty.call(errors, name)) {
      const nextErrors = {
        ...errors
      };
      delete nextErrors[name];
      setErrors(nextErrors);
    }
  });
  const contextValue = React.useMemo(() => ({
    formRef,
    validationMode,
    errors: errors ?? EMPTY_OBJECT,
    clearErrors,
    submitAttemptedRef
  }), [formRef, validationMode, errors, clearErrors]);
  return /*#__PURE__*/_jsx(FormContext.Provider, {
    value: contextValue,
    children: element
  });
});
if (process.env.NODE_ENV !== "production") Form.displayName = "Form";