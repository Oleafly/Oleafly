"use strict";
'use client';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useNumberFieldStepperButton = useNumberFieldStepperButton;
var _useRenderElement = require("../../internals/useRenderElement");
var _useButton = require("../../internals/use-button");
var _NumberFieldRootContext = require("./NumberFieldRootContext");
var _useNumberFieldButton = require("./useNumberFieldButton");
var _stateAttributesMapping = require("../utils/stateAttributesMapping");
/**
 * Shared implementation for the increment and decrement stepper buttons. They differ only in the
 * direction they step and the boundary (`max` vs `min`) at which they become disabled.
 */
function useNumberFieldStepperButton(componentProps, forwardedRef, isIncrement) {
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
  } = (0, _NumberFieldRootContext.useNumberFieldRootContext)();
  const isAtBoundary = value != null && (isIncrement ? value >= maxWithDefault : value <= minWithDefault);
  const disabled = disabledProp || contextDisabled || isAtBoundary;
  const props = (0, _useNumberFieldButton.useNumberFieldButton)({
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
  } = (0, _useButton.useButton)({
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
  return (0, _useRenderElement.useRenderElement)('button', componentProps, {
    ref: [forwardedRef, buttonRef],
    state: buttonState,
    props: [props, elementProps, getButtonProps],
    stateAttributesMapping: _stateAttributesMapping.stateAttributesMapping
  });
}