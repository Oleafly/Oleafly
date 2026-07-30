'use client';

import * as React from 'react';
import { useIsoLayoutEffect } from '@base-ui/utils/useIsoLayoutEffect';
import { useStableCallback } from '@base-ui/utils/useStableCallback';
import { FieldRootContext } from "../../internals/field-root-context/FieldRootContext.mjs";
import { DEFAULT_VALIDITY_STATE, fieldValidityMapping } from "../../internals/field-constants/constants.mjs";
import { useFieldsetRootContext } from "../../fieldset/root/FieldsetRootContext.mjs";
import { useFormContext } from "../../internals/form-context/FormContext.mjs";
import { LabelableProvider } from "../../internals/labelable-provider/index.mjs";
import { useRenderElement } from "../../internals/useRenderElement.mjs";
import { useFieldValidation } from "./useFieldValidation.mjs";
import { useFieldControlRegistration } from "../../internals/field-register-control/useFieldControlRegistration.mjs";

/**
 * @internal
 */
import { jsx as _jsx } from "react/jsx-runtime";
const FieldRootInner = /*#__PURE__*/React.forwardRef(function FieldRootInner(componentProps, forwardedRef) {
  const {
    errors,
    validationMode: formValidationMode,
    submitAttemptedRef
  } = useFormContext();
  const {
    render,
    className,
    validate: validateProp,
    validationDebounceTime = 0,
    validationMode = formValidationMode,
    name,
    disabled: disabledProp = false,
    invalid: invalidProp,
    dirty: dirtyProp,
    touched: touchedProp,
    actionsRef,
    style,
    ...elementProps
  } = componentProps;
  const disabledFieldset = useFieldsetRootContext(true)?.disabled;
  const validate = useStableCallback(validateProp || (() => null));
  const disabled = disabledFieldset || disabledProp;
  const [touchedState, setTouchedUnwrapped] = React.useState(false);
  const [dirtyState, setDirtyUnwrapped] = React.useState(false);
  const [filled, setFilled] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const dirty = dirtyProp ?? dirtyState;
  const touched = touchedProp ?? touchedState;
  const markedDirtyRef = React.useRef(dirty);
  const registeredFieldIdRef = React.useRef(undefined);
  const [registeredFieldName, setRegisteredFieldName] = React.useState();
  const effectiveName = name ?? registeredFieldName;
  useIsoLayoutEffect(() => {
    if (dirtyProp !== undefined) {
      markedDirtyRef.current = dirtyProp;
    }
  }, [dirtyProp]);
  const getRegisteredFieldId = React.useCallback(() => registeredFieldIdRef.current, []);
  const setRegisteredFieldId = React.useCallback(id => {
    registeredFieldIdRef.current = id;
  }, []);
  const setDirty = useStableCallback(value => {
    if (dirtyProp !== undefined) {
      return;
    }
    if (value) {
      markedDirtyRef.current = true;
    }
    setDirtyUnwrapped(value);
  });
  const setTouched = useStableCallback(value => {
    if (touchedProp !== undefined) {
      return;
    }
    setTouchedUnwrapped(value);
  });
  const shouldValidateOnChange = useStableCallback(() => validationMode === 'onChange' || validationMode === 'onSubmit' && submitAttemptedRef.current);
  const formError = effectiveName && Object.hasOwn(errors, effectiveName) ? errors[effectiveName] : null;
  const hasFormError = !!(Array.isArray(formError) ? formError.length : formError);
  const invalid = invalidProp === true || hasFormError;
  const [validityData, setValidityData] = React.useState({
    state: DEFAULT_VALIDITY_STATE,
    error: '',
    errors: [],
    value: null,
    initialValue: null
  });
  const valid = disabled ? null : !invalid && validityData.state.valid;
  const state = React.useMemo(() => ({
    disabled,
    touched,
    dirty,
    valid,
    filled,
    focused
  }), [disabled, touched, dirty, valid, filled, focused]);
  const validation = useFieldValidation({
    setValidityData,
    validate,
    validityData,
    validationDebounceTime,
    invalid,
    markedDirtyRef,
    state,
    shouldValidateOnChange,
    getRegisteredFieldId
  });
  const [validateFieldControl, registerFieldControl] = useFieldControlRegistration({
    commit: validation.commit,
    invalid,
    markedDirtyRef,
    name,
    setRegisteredFieldName,
    setRegisteredFieldId,
    setValidityData,
    validityData
  });
  React.useImperativeHandle(actionsRef, () => ({
    validate: validateFieldControl
  }), [validateFieldControl]);
  const contextValue = React.useMemo(() => ({
    invalid,
    name: effectiveName,
    validityData,
    setValidityData,
    disabled,
    touched,
    setTouched,
    dirty,
    setDirty,
    filled,
    setFilled,
    focused,
    setFocused,
    validate,
    validationMode,
    validationDebounceTime,
    shouldValidateOnChange,
    state,
    markedDirtyRef,
    registerFieldControl,
    validation
  }), [invalid, effectiveName, validityData, disabled, touched, setTouched, dirty, setDirty, filled, setFilled, focused, setFocused, validate, validationMode, validationDebounceTime, shouldValidateOnChange, state, registerFieldControl, validation]);
  const element = useRenderElement('div', componentProps, {
    ref: forwardedRef,
    state,
    props: elementProps,
    stateAttributesMapping: fieldValidityMapping
  });
  return /*#__PURE__*/_jsx(FieldRootContext.Provider, {
    value: contextValue,
    children: element
  });
});

/**
 * Groups all parts of the field.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Field](https://base-ui.com/react/components/field)
 */
if (process.env.NODE_ENV !== "production") FieldRootInner.displayName = "FieldRootInner";
export const FieldRoot = /*#__PURE__*/React.forwardRef(function FieldRoot(componentProps, forwardedRef) {
  return /*#__PURE__*/_jsx(LabelableProvider, {
    children: /*#__PURE__*/_jsx(FieldRootInner, {
      ...componentProps,
      ref: forwardedRef
    })
  });
});
if (process.env.NODE_ENV !== "production") FieldRoot.displayName = "FieldRoot";