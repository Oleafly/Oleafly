'use client';

import { useRenderElement } from "../../internals/useRenderElement.mjs";
import { useButton } from "../../internals/use-button/index.mjs";
import { useNumberFieldRootContext } from "./NumberFieldRootContext.mjs";
import { useNumberFieldButton } from "./useNumberFieldButton.mjs";
import { stateAttributesMapping } from "../utils/stateAttributesMapping.mjs";
/**
 * Shared implementation for the increment and decrement stepper buttons. They differ only in the
 * direction they step and the boundary (`max` vs `min`) at which they become disabled.
 */
export function useNumberFieldStepperButton(componentProps, forwardedRef, isIncrement) {
  const {
    render,
    className,
    disabled: disabledProp = false,
    nativeButton = true,
    style,
    ...elementProps
  } = componentProps;
  const {
    allowInputSyncRef,
    disabled: contextDisabled,
    formatOptionsRef,
    getStepAmount,
    id,
    incrementValue,
    inputRef,
    inputValue,
    maxWithDefault,
    minWithDefault,
    readOnly,
    setValue,
    state,
    value,
    valueRef,
    locale,
    lastChangedValueRef,
    onValueCommitted
  } = useNumberFieldRootContext();
  const isAtBoundary = value != null && (isIncrement ? value >= maxWithDefault : value <= minWithDefault);
  const disabled = disabledProp || contextDisabled || isAtBoundary;
  const props = useNumberFieldButton({
    isIncrement,
    inputRef,
    inputValue,
    disabled,
    readOnly,
    id,
    setValue,
    getStepAmount,
    incrementValue,
    allowInputSyncRef,
    formatOptionsRef,
    valueRef,
    locale,
    lastChangedValueRef,
    onValueCommitted
  });
  const {
    getButtonProps,
    buttonRef
  } = useButton({
    // Read-only steppers are exposed as unavailable through button disabled semantics, while
    // `data-readonly` (from `state`) is preserved for styling. `aria-readonly` isn't valid on the
    // `button` role, so it's intentionally not set.
    disabled: disabled || readOnly,
    native: nativeButton,
    focusableWhenDisabled: true
  });
  const buttonState = {
    ...state,
    disabled
  };
  return useRenderElement('button', componentProps, {
    ref: [forwardedRef, buttonRef],
    state: buttonState,
    props: [props, elementProps, getButtonProps],
    stateAttributesMapping
  });
}