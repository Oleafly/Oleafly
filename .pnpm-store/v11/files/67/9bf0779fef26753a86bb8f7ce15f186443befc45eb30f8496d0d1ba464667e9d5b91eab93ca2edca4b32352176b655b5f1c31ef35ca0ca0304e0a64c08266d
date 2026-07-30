'use client';

import * as React from 'react';
import { EMPTY_OBJECT } from '@base-ui/utils/empty';
import { useControlled } from '@base-ui/utils/useControlled';
import { useIsoLayoutEffect } from '@base-ui/utils/useIsoLayoutEffect';
import { useMergedRefs } from '@base-ui/utils/useMergedRefs';
import { useRefWithInit } from '@base-ui/utils/useRefWithInit';
import { visuallyHidden, visuallyHiddenInput } from '@base-ui/utils/visuallyHidden';
import { ownerWindow } from '@base-ui/utils/owner';
import { getDefaultFormSubmitter } from '@base-ui/utils/getDefaultFormSubmitter';
import { NOOP } from "../../internals/noop.mjs";
import { useStateAttributesMapping } from "../utils/useStateAttributesMapping.mjs";
import { useRenderElement } from "../../internals/useRenderElement.mjs";
import { useBaseUiId } from "../../internals/useBaseUiId.mjs";
import { mergeProps } from "../../merge-props/index.mjs";
import { useButton } from "../../internals/use-button/useButton.mjs";
import { useFieldRootContext } from "../../internals/field-root-context/FieldRootContext.mjs";
import { useRegisterFieldControl } from "../../internals/field-register-control/useRegisterFieldControl.mjs";
import { useFieldItemContext } from "../../field/item/FieldItemContext.mjs";
import { useFormContext } from "../../internals/form-context/FormContext.mjs";
import { useLabelableContext } from "../../internals/labelable-provider/LabelableContext.mjs";
import { useAriaLabelledBy } from "../../internals/labelable-provider/useAriaLabelledBy.mjs";
import { useCheckboxGroupContext } from "../../checkbox-group/CheckboxGroupContext.mjs";
import { CheckboxRootContext } from "./CheckboxRootContext.mjs";
import { createChangeEventDetails } from "../../internals/createBaseUIEventDetails.mjs";
import { REASONS } from "../../internals/reasons.mjs";
import { useValueChanged } from "../../internals/useValueChanged.mjs";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export const PARENT_CHECKBOX = 'data-parent';

/**
 * Represents the checkbox itself.
 * Renders a `<span>` element and a hidden `<input>` beside.
 *
 * Documentation: [Base UI Checkbox](https://base-ui.com/react/components/checkbox)
 */
export const CheckboxRoot = /*#__PURE__*/React.forwardRef(function CheckboxRoot(componentProps, forwardedRef) {
  const {
    checked: checkedProp,
    className,
    defaultChecked = false,
    'aria-labelledby': ariaLabelledByProp,
    disabled: disabledProp = false,
    form,
    id: idProp,
    indeterminate = false,
    inputRef: inputRefProp,
    name: nameProp,
    onCheckedChange,
    parent = false,
    readOnly = false,
    render,
    required = false,
    uncheckedValue,
    value: valueProp,
    nativeButton = false,
    style,
    ...elementProps
  } = componentProps;
  const {
    clearErrors
  } = useFormContext();
  const {
    disabled: rootDisabled,
    name: fieldName,
    setDirty,
    setFilled,
    setFocused,
    setTouched,
    state: fieldState,
    validationMode,
    validityData,
    validation: localValidation
  } = useFieldRootContext();
  const fieldItemContext = useFieldItemContext();
  const {
    labelId,
    controlId,
    registerControlId,
    getDescriptionProps
  } = useLabelableContext();
  const groupContext = useCheckboxGroupContext();
  const parentContext = groupContext?.parent;
  const isGroupedWithParent = parentContext && groupContext.allValues;
  const disabled = rootDisabled || fieldItemContext.disabled || groupContext?.disabled || disabledProp;
  const name = fieldName ?? nameProp;
  const value = valueProp ?? name;
  const id = useBaseUiId();
  const parentId = useBaseUiId();
  let inputId = controlId;
  if (isGroupedWithParent) {
    inputId = parent ? parentId : `${parentContext.id}-${value}`;
  } else if (idProp) {
    inputId = idProp;
  }
  let groupProps = {};
  if (isGroupedWithParent) {
    if (parent) {
      groupProps = groupContext.parent.getParentProps();
    } else if (value) {
      groupProps = groupContext.parent.getChildProps(value);
    }
  }
  const {
    checked: groupChecked = checkedProp,
    indeterminate: groupIndeterminate = indeterminate,
    onCheckedChange: groupOnChange,
    ...otherGroupProps
  } = groupProps;
  const groupValue = groupContext?.value;
  const setGroupValue = groupContext?.setValue;
  const defaultGroupValue = groupContext?.defaultValue;
  const controlRef = React.useRef(null);
  const controlSourceRef = useRefWithInit(() => Symbol('checkbox-control'));
  const hasRegisteredRef = React.useRef(false);
  const {
    getButtonProps,
    buttonRef
  } = useButton({
    disabled,
    native: nativeButton
  });
  const validation = groupContext?.validation ?? localValidation;
  const [checked, setCheckedState] = useControlled({
    controlled: value && groupValue && !parent ? groupValue.includes(value) : groupChecked,
    default: value && defaultGroupValue && !parent ? defaultGroupValue.includes(value) : defaultChecked,
    name: 'Checkbox',
    state: 'checked'
  });
  const computedChecked = isGroupedWithParent ? Boolean(groupChecked) : checked;
  const computedIndeterminate = isGroupedWithParent ? groupIndeterminate || indeterminate : indeterminate;

  // can't use useLabelableId because of optional groupContext and/or parent
  useIsoLayoutEffect(() => {
    if (registerControlId === NOOP) {
      return undefined;
    }
    hasRegisteredRef.current = true;
    registerControlId(controlSourceRef.current, inputId);
    return undefined;
  }, [inputId, registerControlId, controlSourceRef]);
  React.useEffect(() => {
    const controlSource = controlSourceRef.current;
    return () => {
      if (!hasRegisteredRef.current || registerControlId === NOOP) {
        return;
      }
      hasRegisteredRef.current = false;
      registerControlId(controlSource, undefined);
    };
  }, [registerControlId, controlSourceRef]);
  useRegisterFieldControl(controlRef, id, checked, undefined, !groupContext && !disabled, nameProp);
  const inputRef = React.useRef(null);
  const mergedInputRef = useMergedRefs(inputRefProp, inputRef, validation.inputRef, validation.registerInput);
  const ariaLabelledBy = useAriaLabelledBy(ariaLabelledByProp, labelId, inputRef, !nativeButton, inputId ?? undefined);
  useIsoLayoutEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = computedIndeterminate;
      if (checked) {
        setFilled(true);
      }
    }
  }, [checked, computedIndeterminate, setFilled]);
  useValueChanged(checked, () => {
    if (groupContext) {
      return;
    }
    clearErrors(name);
    setFilled(checked);
    setDirty(checked !== validityData.initialValue);
    validation.change(checked);
  });
  const inputProps = mergeProps({
    checked,
    disabled,
    form,
    // parent checkboxes unset `name` to be excluded from form submission
    name: parent ? undefined : name,
    // Set `id` to stop Chrome warning about an unassociated input.
    // When using a native button, the `id` is applied to the button instead.
    id: nativeButton ? undefined : inputId ?? undefined,
    required,
    ref: mergedInputRef,
    style: name ? visuallyHiddenInput : visuallyHidden,
    tabIndex: -1,
    type: 'checkbox',
    'aria-hidden': true,
    onChange(event) {
      // Workaround for https://github.com/facebook/react/issues/9023
      if (event.nativeEvent.defaultPrevented) {
        return;
      }
      if (readOnly) {
        event.preventDefault();
        return;
      }
      const nextChecked = event.currentTarget.checked;
      const details = createChangeEventDetails(REASONS.none, event.nativeEvent);
      onCheckedChange?.(nextChecked, details);
      if (details.isCanceled) {
        return;
      }
      groupOnChange?.(nextChecked, details);
      if (details.isCanceled) {
        return;
      }
      setCheckedState(nextChecked);
      if (value && groupValue && setGroupValue && !parent && !isGroupedWithParent) {
        const nextGroupValue = nextChecked ? [...groupValue, value] : groupValue.filter(item => item !== value);
        setGroupValue(nextGroupValue, details);
      }
    },
    onFocus() {
      controlRef.current?.focus();
    }
  },
  // React <19 sets an empty value if `undefined` is passed explicitly
  // To avoid this, we only set the value if it's defined
  valueProp !== undefined ? {
    value: (groupContext ? checked && valueProp : valueProp) || ''
  } : EMPTY_OBJECT, getDescriptionProps, props => validation.getValidationProps(disabled, props));
  React.useEffect(() => {
    if (!parentContext || !value) {
      return undefined;
    }
    const disabledStates = parentContext.disabledStatesRef.current;
    disabledStates.set(value, disabled);
    return () => {
      disabledStates.delete(value);
    };
  }, [parentContext, disabled, value]);
  const state = React.useMemo(() => ({
    ...fieldState,
    checked: computedChecked,
    disabled,
    readOnly,
    required,
    indeterminate: computedIndeterminate
  }), [fieldState, computedChecked, disabled, readOnly, required, computedIndeterminate]);
  const stateAttributesMapping = useStateAttributesMapping(state);
  const element = useRenderElement('span', componentProps, {
    state,
    ref: [buttonRef, controlRef, forwardedRef, groupContext?.registerControlRef],
    props: [{
      id: nativeButton ? inputId ?? undefined : id,
      role: 'checkbox',
      'aria-checked': computedIndeterminate ? 'mixed' : computedChecked,
      'aria-readonly': readOnly || undefined,
      'aria-required': required || undefined,
      'aria-labelledby': ariaLabelledBy,
      [PARENT_CHECKBOX]: parent ? '' : undefined,
      onFocus() {
        if (!disabled) {
          setFocused(true);
        }
      },
      onBlur() {
        const inputEl = inputRef.current;
        if (!inputEl) {
          return;
        }
        setTouched(true);
        setFocused(false);
        if (validationMode === 'onBlur') {
          validation.commit(groupContext ? groupValue : inputEl.checked);
        }
      },
      onKeyDown(event) {
        if (event.key !== 'Enter') {
          return;
        }

        // Let consumer `preventDefault()` handlers opt out while defensively stopping
        // any remaining Base UI Enter handling from treating the checkbox as a button.
        event.preventBaseUIHandler();
        if (event.defaultPrevented) {
          return;
        }
        const formToSubmit = inputRef.current?.form ?? null;
        const currentTarget = event.currentTarget;
        const nativeEvent = event.nativeEvent;
        const originalPreventDefault = event.preventDefault;
        const originalNativePreventDefault = nativeEvent.preventDefault;
        let preventDefaultCalledAfterPropagation = false;
        event.preventDefault = () => {
          preventDefaultCalledAfterPropagation = true;
          originalPreventDefault.call(event);
        };
        nativeEvent.preventDefault = () => {
          preventDefaultCalledAfterPropagation = true;
          originalNativePreventDefault.call(nativeEvent);
        };

        // Enter should not activate/toggle the checkbox. Cancel the native button behavior
        // without setting React's synthetic `defaultPrevented`, so ancestor React handlers
        // can still opt out by calling `preventDefault()` during propagation.
        originalNativePreventDefault.call(nativeEvent);
        ownerWindow(currentTarget).queueMicrotask(() => {
          event.preventDefault = originalPreventDefault;
          nativeEvent.preventDefault = originalNativePreventDefault;
          if (!preventDefaultCalledAfterPropagation) {
            getDefaultFormSubmitter(formToSubmit)?.click();
          }
        });
      },
      onClick(event) {
        if (readOnly || disabled) {
          return;
        }
        event.preventDefault();
        const input = inputRef.current;
        if (!input) {
          return;
        }
        input.dispatchEvent(new (ownerWindow(input).PointerEvent)('click', {
          bubbles: true,
          shiftKey: event.shiftKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          metaKey: event.metaKey
        }));
      }
    }, elementProps, otherGroupProps, getButtonProps, getDescriptionProps, props => validation.getValidationProps(disabled, props)],
    stateAttributesMapping
  });
  return /*#__PURE__*/_jsxs(CheckboxRootContext.Provider, {
    value: state,
    children: [element, !checked && !groupContext && name && !parent && uncheckedValue !== undefined && /*#__PURE__*/_jsx("input", {
      type: "hidden",
      form: form,
      name: name,
      value: uncheckedValue,
      disabled: disabled
    }), /*#__PURE__*/_jsx("input", {
      ...inputProps,
      suppressHydrationWarning: true
    })]
  });
});
if (process.env.NODE_ENV !== "production") CheckboxRoot.displayName = "CheckboxRoot";