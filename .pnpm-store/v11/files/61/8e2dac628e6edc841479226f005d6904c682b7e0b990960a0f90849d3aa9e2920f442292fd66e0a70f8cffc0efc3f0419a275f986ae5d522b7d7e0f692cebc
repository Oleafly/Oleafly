'use client';

import * as React from 'react';
import { useControlled } from '@base-ui/utils/useControlled';
import { useStableCallback } from '@base-ui/utils/useStableCallback';
import { EMPTY_ARRAY } from '@base-ui/utils/empty';
import { useBaseUiId } from "../internals/useBaseUiId.mjs";
import { useRenderElement } from "../internals/useRenderElement.mjs";
import { CheckboxGroupContext } from "./CheckboxGroupContext.mjs";
import { useFieldRootContext } from "../internals/field-root-context/FieldRootContext.mjs";
import { useRegisterFieldControl } from "../internals/field-register-control/useRegisterFieldControl.mjs";
import { useLabelableContext } from "../internals/labelable-provider/LabelableContext.mjs";
import { fieldValidityMapping } from "../internals/field-constants/constants.mjs";
import { PARENT_CHECKBOX } from "../checkbox/root/CheckboxRoot.mjs";
import { useCheckboxGroupParent } from "./useCheckboxGroupParent.mjs";
import { useFormContext } from "../internals/form-context/FormContext.mjs";
import { useValueChanged } from "../internals/useValueChanged.mjs";
import { areArraysEqual } from "../internals/areArraysEqual.mjs";

/**
 * Provides a shared state to a series of checkboxes.
 *
 * Documentation: [Base UI Checkbox Group](https://base-ui.com/react/components/checkbox-group)
 */
import { jsx as _jsx } from "react/jsx-runtime";
export const CheckboxGroup = /*#__PURE__*/React.forwardRef(function CheckboxGroup(componentProps, forwardedRef) {
  const {
    allValues,
    className,
    defaultValue: defaultValueProp,
    disabled: disabledProp = false,
    id: idProp,
    onValueChange,
    render,
    value: externalValue,
    style,
    ...elementProps
  } = componentProps;
  const {
    disabled: fieldDisabled,
    name: fieldName,
    state: fieldState,
    validation,
    setFilled,
    setDirty,
    validityData
  } = useFieldRootContext();
  const {
    labelId,
    getDescriptionProps
  } = useLabelableContext();
  const {
    clearErrors
  } = useFormContext();
  const disabled = fieldDisabled || disabledProp;
  const defaultValue = React.useMemo(() => {
    if (externalValue === undefined) {
      return defaultValueProp ?? [];
    }
    return undefined;
  }, [externalValue, defaultValueProp]);
  const [value, setValueUnwrapped] = useControlled({
    controlled: externalValue,
    default: defaultValue,
    name: 'CheckboxGroup',
    state: 'value'
  });
  const setValue = useStableCallback((v, eventDetails) => {
    onValueChange?.(v, eventDetails);
    if (eventDetails.isCanceled) {
      return;
    }
    setValueUnwrapped(v);
  });
  const parent = useCheckboxGroupParent({
    allValues,
    value,
    onValueChange: setValue
  });
  const id = useBaseUiId(idProp);
  const controlRef = React.useRef(null);
  const registerControlRef = React.useCallback(element => {
    if (controlRef.current == null && element != null && !element.hasAttribute(PARENT_CHECKBOX)) {
      controlRef.current = element;
    }
  }, []);
  useRegisterFieldControl(controlRef, id, value, undefined, !!fieldName && !disabled, fieldName);
  const resolvedValue = value ?? EMPTY_ARRAY;
  useValueChanged(resolvedValue, () => {
    if (fieldName) {
      clearErrors(fieldName);
    }
    const initialValue = Array.isArray(validityData.initialValue) ? validityData.initialValue : EMPTY_ARRAY;
    setFilled(resolvedValue.length > 0);
    setDirty(!areArraysEqual(resolvedValue, initialValue));
    validation.change(resolvedValue);
  });
  const state = {
    ...fieldState,
    disabled
  };
  const contextValue = React.useMemo(() => ({
    allValues,
    value,
    defaultValue,
    setValue,
    parent,
    disabled,
    validation,
    registerControlRef
  }), [allValues, value, defaultValue, setValue, parent, disabled, validation, registerControlRef]);
  const element = useRenderElement('div', componentProps, {
    state,
    ref: forwardedRef,
    props: [{
      id: idProp,
      role: 'group',
      'aria-labelledby': labelId
    }, elementProps, getDescriptionProps],
    stateAttributesMapping: fieldValidityMapping
  });
  return /*#__PURE__*/_jsx(CheckboxGroupContext.Provider, {
    value: contextValue,
    children: element
  });
});
if (process.env.NODE_ENV !== "production") CheckboxGroup.displayName = "CheckboxGroup";