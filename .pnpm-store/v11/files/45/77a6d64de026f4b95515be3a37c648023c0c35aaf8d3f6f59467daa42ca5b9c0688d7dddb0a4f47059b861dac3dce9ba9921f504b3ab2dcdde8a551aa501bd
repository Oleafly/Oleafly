'use client';

import * as React from 'react';
import { useControlled } from '@base-ui/utils/useControlled';
import { useIsoLayoutEffect } from '@base-ui/utils/useIsoLayoutEffect';
import { ownerDocument } from '@base-ui/utils/owner';
import { useStableCallback } from '@base-ui/utils/useStableCallback';
import { useFieldRootContext } from "../../internals/field-root-context/FieldRootContext.mjs";
import { useRegisterFieldControl } from "../../internals/field-register-control/useRegisterFieldControl.mjs";
import { useFormContext } from "../../internals/form-context/FormContext.mjs";
import { useLabelableContext } from "../../internals/labelable-provider/LabelableContext.mjs";
import { useLabelableId } from "../../internals/labelable-provider/useLabelableId.mjs";
import { fieldValidityMapping } from "../../internals/field-constants/constants.mjs";
import { useRenderElement } from "../../internals/useRenderElement.mjs";
import { createChangeEventDetails } from "../../internals/createBaseUIEventDetails.mjs";
import { REASONS } from "../../internals/reasons.mjs";
import { activeElement } from "../../floating-ui-react/utils.mjs";

/**
 * The form control to label and validate.
 * Renders an `<input>` element.
 *
 * You can omit this part and use any Base UI input component instead. For example,
 * [Input](https://base-ui.com/react/components/input), [Checkbox](https://base-ui.com/react/components/checkbox),
 * or [Select](https://base-ui.com/react/components/select), among others, will work with Field out of the box.
 *
 * Documentation: [Base UI Field](https://base-ui.com/react/components/field)
 */
export const FieldControl = /*#__PURE__*/React.forwardRef(function FieldControl(componentProps, forwardedRef) {
  const {
    render,
    className,
    id: idProp,
    name: nameProp,
    value: valueProp,
    disabled: disabledProp = false,
    onValueChange,
    defaultValue,
    autoFocus = false,
    style,
    ...elementProps
  } = componentProps;
  const {
    state: fieldState,
    name: fieldName,
    disabled: fieldDisabled,
    setTouched,
    setDirty,
    validityData,
    setFocused,
    setFilled,
    validationMode,
    validation
  } = useFieldRootContext();
  const {
    clearErrors
  } = useFormContext();
  const disabled = fieldDisabled || disabledProp;
  const name = fieldName ?? nameProp;
  const state = {
    ...fieldState,
    disabled
  };
  const {
    labelId
  } = useLabelableContext();
  const id = useLabelableId({
    id: idProp
  });
  useIsoLayoutEffect(() => {
    const hasExternalValue = valueProp != null;
    if (validation.inputRef.current?.value || hasExternalValue && valueProp !== '') {
      setFilled(true);
    } else if (hasExternalValue && valueProp === '') {
      setFilled(false);
    }
  }, [validation.inputRef, setFilled, valueProp]);
  const inputRef = React.useRef(null);
  useIsoLayoutEffect(() => {
    if (autoFocus && inputRef.current === activeElement(ownerDocument(inputRef.current))) {
      setFocused(true);
    }
  }, [autoFocus, setFocused]);
  const [valueUnwrapped] = useControlled({
    controlled: valueProp,
    default: defaultValue,
    name: 'FieldControl',
    state: 'value'
  });
  const isControlled = valueProp !== undefined;
  const value = isControlled ? valueUnwrapped : undefined;
  const getValueFromInput = useStableCallback(() => validation.inputRef.current?.value);
  useRegisterFieldControl(validation.inputRef, id, value, getValueFromInput, !disabled, nameProp);
  const element = useRenderElement('input', componentProps, {
    ref: [forwardedRef, inputRef],
    state,
    props: [{
      id,
      disabled,
      name,
      ref: validation.inputRef,
      'aria-labelledby': labelId,
      autoFocus,
      ...(isControlled ? {
        value
      } : {
        defaultValue
      }),
      onChange(event) {
        const inputValue = event.currentTarget.value;
        onValueChange?.(inputValue, createChangeEventDetails(REASONS.none, event.nativeEvent));
        // `validation.change` reads `markedDirtyRef`, so update dirty before validating.
        setDirty(inputValue !== validityData.initialValue);
        setFilled(inputValue !== '');

        // Workaround for https://github.com/facebook/react/issues/9023
        if (!event.nativeEvent.defaultPrevented) {
          clearErrors(name);
          validation.change(inputValue);
        }
      },
      onFocus() {
        setFocused(true);
      },
      onBlur(event) {
        setTouched(true);
        setFocused(false);
        if (validationMode === 'onBlur') {
          validation.commit(event.currentTarget.value);
        }
      },
      onKeyDown(event) {
        if (event.currentTarget.tagName === 'INPUT' && event.key === 'Enter') {
          setTouched(true);
          validation.commit(event.currentTarget.value);
        }
      }
    }, elementProps, props => validation.getValidationProps(disabled, props)],
    stateAttributesMapping: fieldValidityMapping
  });
  return element;
});
if (process.env.NODE_ENV !== "production") FieldControl.displayName = "FieldControl";