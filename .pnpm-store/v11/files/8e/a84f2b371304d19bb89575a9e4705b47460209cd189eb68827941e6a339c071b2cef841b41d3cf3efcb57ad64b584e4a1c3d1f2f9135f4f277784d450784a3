'use client';

import * as React from 'react';
import { useControlled } from '@base-ui/utils/useControlled';
import { useStableCallback } from '@base-ui/utils/useStableCallback';
import { useBaseUiId } from "../internals/useBaseUiId.mjs";
import { contains } from "../floating-ui-react/utils.mjs";
import { SHIFT } from "../internals/composite/composite.mjs";
import { CompositeRoot } from "../internals/composite/root/CompositeRoot.mjs";
import { useFieldRootContext } from "../internals/field-root-context/FieldRootContext.mjs";
import { useRegisterFieldControl } from "../internals/field-register-control/useRegisterFieldControl.mjs";
import { fieldValidityMapping } from "../internals/field-constants/constants.mjs";
import { useFieldsetRootContext } from "../fieldset/root/FieldsetRootContext.mjs";
import { useFormContext } from "../internals/form-context/FormContext.mjs";
import { useLabelableContext } from "../internals/labelable-provider/LabelableContext.mjs";
import { useValueChanged } from "../internals/useValueChanged.mjs";
import { RadioGroupContext } from "./RadioGroupContext.mjs";
import { jsx as _jsx } from "react/jsx-runtime";
const MODIFIER_KEYS = [SHIFT];

/**
 * Provides a shared state to a series of radio buttons.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Radio Group](https://base-ui.com/react/components/radio)
 */
export const RadioGroup = /*#__PURE__*/React.forwardRef(function RadioGroup(componentProps, forwardedRef) {
  const {
    render,
    className,
    disabled: disabledProp,
    readOnly,
    required,
    onValueChange: onValueChangeProp,
    value: externalValue,
    defaultValue,
    form,
    name: nameProp,
    inputRef: inputRefProp,
    id: idProp,
    style,
    ...elementProps
  } = componentProps;
  const {
    setTouched: setFieldTouched,
    setFocused,
    validationMode,
    name: fieldName,
    disabled: fieldDisabled,
    state: fieldState,
    validation,
    setDirty,
    setFilled,
    validityData
  } = useFieldRootContext();
  const {
    labelId
  } = useLabelableContext();
  const {
    clearErrors
  } = useFormContext();
  const fieldsetContext = useFieldsetRootContext(true);
  const disabled = fieldDisabled || disabledProp;
  const name = fieldName ?? nameProp;
  const id = useBaseUiId(idProp);
  const [checkedValue, setCheckedValueUnwrapped] = useControlled({
    controlled: externalValue,
    default: defaultValue,
    name: 'RadioGroup',
    state: 'value'
  });
  const [touched, setTouched] = React.useState(false);
  const setCheckedValue = useStableCallback((value, eventDetails) => {
    onValueChangeProp?.(value, eventDetails);
    if (eventDetails.isCanceled) {
      return;
    }
    setCheckedValueUnwrapped(value);
  });
  const controlRef = React.useRef(null);
  const groupInputRef = React.useRef(null);
  const firstEnabledInputRef = React.useRef(null);
  function setInputRef(hiddenInput) {
    let cleanup = undefined;
    if (inputRefProp) {
      if (typeof inputRefProp === 'function') {
        cleanup = inputRefProp(hiddenInput);
      } else {
        inputRefProp.current = hiddenInput;
      }
    }
    groupInputRef.current = hiddenInput;
    validation.inputRef.current = hiddenInput;
    return cleanup;
  }
  const registerControlRef = useStableCallback((element, isDisabled = false) => {
    if (!element) {
      return;
    }
    if (isDisabled) {
      if (controlRef.current === element) {
        controlRef.current = null;
      }
      return;
    }
    if (controlRef.current == null) {
      controlRef.current = element;
    }
  });
  const registerInputRef = useStableCallback(input => {
    if (!input || input.disabled) {
      return undefined;
    }
    if (!firstEnabledInputRef.current) {
      firstEnabledInputRef.current = input;
    }
    const currentInput = groupInputRef.current;
    if (input.checked || currentInput == null || currentInput.disabled) {
      return setInputRef(input);
    }
    return undefined;
  });
  const getFormValue = useStableCallback(() => {
    // Disabled radios are excluded from native form submission, so a disabled
    // selection shouldn't be reported as the field's value either.
    const input = groupInputRef.current;
    if (!input || input.disabled || !input.checked) {
      return null;
    }
    return checkedValue ?? null;
  });
  useRegisterFieldControl(controlRef, id, checkedValue ?? null, getFormValue, !disabled, nameProp);
  useValueChanged(checkedValue, () => {
    clearErrors(name);
    setDirty(checkedValue !== validityData.initialValue);
    setFilled(checkedValue != null);
    validation.change(checkedValue);
    const fallbackInput = firstEnabledInputRef.current;
    if (checkedValue == null && fallbackInput && !fallbackInput.disabled) {
      setInputRef(fallbackInput);
    }
  });
  const ariaLabelledby = elementProps['aria-labelledby'] ?? labelId ?? fieldsetContext?.legendId;
  const state = {
    ...fieldState,
    disabled: disabled ?? false,
    required: required ?? false,
    readOnly: readOnly ?? false
  };
  const contextValue = React.useMemo(() => ({
    ...fieldState,
    checkedValue,
    disabled,
    form,
    validation,
    name,
    readOnly,
    registerControlRef,
    registerInputRef,
    required,
    setCheckedValue,
    setTouched,
    touched
  }), [checkedValue, disabled, form, validation, fieldState, name, readOnly, registerControlRef, registerInputRef, required, setCheckedValue, setTouched, touched]);
  const defaultProps = {
    id: idProp,
    role: 'radiogroup',
    'aria-required': required || undefined,
    'aria-disabled': disabled || undefined,
    'aria-readonly': readOnly || undefined,
    'aria-labelledby': ariaLabelledby,
    onFocus() {
      setFocused(true);
    },
    onBlur(event) {
      if (!contains(event.currentTarget, event.relatedTarget)) {
        setFieldTouched(true);
        setFocused(false);
        if (validationMode === 'onBlur') {
          validation.commit(checkedValue);
        }
      }
    },
    onKeyDownCapture(event) {
      if (event.key.startsWith('Arrow')) {
        setTouched(true);
        setFocused(true);
      }
    }
  };
  return /*#__PURE__*/_jsx(RadioGroupContext.Provider, {
    value: contextValue,
    children: /*#__PURE__*/_jsx(CompositeRoot, {
      render: render,
      className: className,
      style: style,
      state: state,
      props: [defaultProps, elementProps, props => validation.getValidationProps(disabled ?? false, props)],
      refs: [forwardedRef],
      stateAttributesMapping: fieldValidityMapping,
      enableHomeAndEndKeys: false,
      modifierKeys: MODIFIER_KEYS
    })
  });
});
if (process.env.NODE_ENV !== "production") RadioGroup.displayName = "RadioGroup";