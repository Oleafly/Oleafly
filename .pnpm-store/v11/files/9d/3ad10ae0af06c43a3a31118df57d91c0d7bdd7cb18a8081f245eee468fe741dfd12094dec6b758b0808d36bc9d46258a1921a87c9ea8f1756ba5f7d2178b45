'use client';

import * as React from 'react';
import { addEventListener } from '@base-ui/utils/addEventListener';
import { useControlled } from '@base-ui/utils/useControlled';
import { useStableCallback } from '@base-ui/utils/useStableCallback';
import { useIsoLayoutEffect } from '@base-ui/utils/useIsoLayoutEffect';
import { useValueAsRef } from '@base-ui/utils/useValueAsRef';
import { useForcedRerendering } from '@base-ui/utils/useForcedRerendering';
import { useMergedRefs } from '@base-ui/utils/useMergedRefs';
import { visuallyHidden, visuallyHiddenInput } from '@base-ui/utils/visuallyHidden';
import { ownerDocument } from '@base-ui/utils/owner';
import { platform } from '@base-ui/utils/platform';
import { activeElement } from "../../floating-ui-react/utils.mjs";
import { NumberFieldRootContext } from "./NumberFieldRootContext.mjs";
import { useFieldRootContext } from "../../internals/field-root-context/FieldRootContext.mjs";
import { useFormContext } from "../../internals/form-context/FormContext.mjs";
import { useLabelableId } from "../../internals/labelable-provider/useLabelableId.mjs";
import { stateAttributesMapping } from "../utils/stateAttributesMapping.mjs";
import { useRenderElement } from "../../internals/useRenderElement.mjs";
import { getNumberLocaleDetails, PERMILLE, PERCENTAGES, SPACE_SEPARATOR_RE, BASE_NON_NUMERIC_SYMBOLS, MINUS_SIGNS_WITH_ASCII, PLUS_SIGNS_WITH_ASCII } from "../utils/parse.mjs";
import { formatNumber } from "../../utils/formatNumber.mjs";
import { toValidatedNumber } from "../utils/validate.mjs";
import { createChangeEventDetails, createGenericEventDetails } from "../../internals/createBaseUIEventDetails.mjs";
import { REASONS } from "../../internals/reasons.mjs";

/**
 * Groups all parts of the number field and manages its state.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Number Field](https://base-ui.com/react/components/number-field)
 */
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export const NumberFieldRoot = /*#__PURE__*/React.forwardRef(function NumberFieldRoot(componentProps, forwardedRef) {
  const {
    id: idProp,
    min,
    max,
    smallStep = 0.1,
    step: stepProp = 1,
    largeStep = 10,
    required = false,
    disabled: disabledProp = false,
    readOnly = false,
    form,
    name: nameProp,
    defaultValue,
    value: valueProp,
    onValueChange: onValueChangeProp,
    onValueCommitted: onValueCommittedProp,
    allowWheelScrub = false,
    snapOnStep = false,
    allowOutOfRange = false,
    format,
    locale,
    render,
    className,
    inputRef: inputRefProp,
    style,
    ...elementProps
  } = componentProps;
  const {
    setDirty,
    validityData,
    disabled: fieldDisabled,
    setFilled,
    invalid,
    name: fieldName,
    state: fieldState,
    validation
  } = useFieldRootContext();
  const {
    clearErrors
  } = useFormContext();
  const disabled = fieldDisabled || disabledProp;
  const name = fieldName ?? nameProp;
  const step = stepProp === 'any' ? 1 : stepProp;
  const [isScrubbing, setIsScrubbing] = React.useState(false);
  const minWithDefault = min ?? Number.MIN_SAFE_INTEGER;
  const maxWithDefault = max ?? Number.MAX_SAFE_INTEGER;
  const minWithZeroDefault = min ?? 0;
  const formatStyle = format?.style;
  const inputRef = React.useRef(null);
  const hiddenInputRef = useMergedRefs(inputRefProp, validation.inputRef);
  const id = useLabelableId({
    id: idProp
  });
  const [valueUnwrapped, setValueUnwrapped] = useControlled({
    controlled: valueProp,
    default: defaultValue,
    name: 'NumberField',
    state: 'value'
  });
  const value = valueUnwrapped ?? null;
  const valueRef = useValueAsRef(value);
  useIsoLayoutEffect(() => {
    setFilled(value !== null);
  }, [setFilled, value]);
  const forceRender = useForcedRerendering();
  const formatOptionsRef = useValueAsRef(format);
  const hasPendingCommitRef = React.useRef(false);
  const onValueCommitted = useStableCallback((nextValue, eventDetails) => {
    hasPendingCommitRef.current = false;
    onValueCommittedProp?.(nextValue, eventDetails);
  });
  const allowInputSyncRef = React.useRef(true);
  const lastChangedValueRef = React.useRef(null);

  // During SSR, the value is formatted on the server, whose locale may differ from the client's
  // locale. This causes a hydration mismatch, which we manually suppress. This is preferable to
  // rendering an empty input field and then updating it with the formatted value, as the user
  // can still see the value prior to hydration, even if it's not formatted correctly.
  const [inputValue, setInputValue] = React.useState(() => formatNumber(value, locale, format));
  const [inputMode, setInputMode] = React.useState('numeric');
  const getAllowedNonNumericKeys = useStableCallback(() => {
    const {
      decimal,
      group,
      currency,
      literal
    } = getNumberLocaleDetails(locale, format);
    const keys = new Set();
    BASE_NON_NUMERIC_SYMBOLS.forEach(symbol => keys.add(symbol));
    if (decimal) {
      keys.add(decimal);
    }
    if (group) {
      keys.add(group);
      if (SPACE_SEPARATOR_RE.test(group)) {
        keys.add(' ');
      }
    }
    const allowPercentSymbols = formatStyle === 'percent' || formatStyle === 'unit' && format?.unit === 'percent';
    const allowPermilleSymbols = formatStyle === 'percent' || formatStyle === 'unit' && format?.unit === 'permille';
    if (allowPercentSymbols) {
      PERCENTAGES.forEach(key => keys.add(key));
    }
    if (allowPermilleSymbols) {
      PERMILLE.forEach(key => keys.add(key));
    }
    if (formatStyle === 'currency' && currency) {
      keys.add(currency);
    }
    if (literal) {
      // Some locales (e.g. de-DE) insert a literal space character between the number
      // and the symbol, so allow those characters to be typed/removed.
      Array.from(literal).forEach(char => keys.add(char));
      if (SPACE_SEPARATOR_RE.test(literal)) {
        keys.add(' ');
      }
    }

    // Allow plus sign in all cases; minus sign when negatives are valid, or when out-of-range
    // entry is allowed so native underflow validation can be triggered from the keyboard.
    PLUS_SIGNS_WITH_ASCII.forEach(key => keys.add(key));
    if (minWithDefault < 0 || allowOutOfRange) {
      MINUS_SIGNS_WITH_ASCII.forEach(key => keys.add(key));
    }
    return keys;
  });
  const getStepAmount = useStableCallback(event => {
    if (event?.altKey) {
      return smallStep;
    }
    if (event?.shiftKey) {
      return largeStep;
    }
    return step;
  });
  const setValue = useStableCallback((unvalidatedValue, details) => {
    const eventWithOptionalKeyState = details.event;
    const dir = details.direction;

    // Direct text entry (typing, pasting, clearing, autofill) behaves natively; step-based
    // interactions (keyboard arrows, buttons, wheel, scrub) do not.
    const isInputReason = details.reason === REASONS.inputChange || details.reason === REASONS.inputClear || details.reason === REASONS.inputBlur || details.reason === REASONS.inputPaste || details.reason === REASONS.none;

    // Only allow out-of-range values for direct text entry. Step-based interactions still clamp.
    const shouldClampValue = !allowOutOfRange || !isInputReason;
    const validatedValue = toValidatedNumber(unvalidatedValue, {
      step: dir ? getStepAmount(eventWithOptionalKeyState) * dir : undefined,
      format: formatOptionsRef.current,
      minWithDefault,
      maxWithDefault,
      minWithZeroDefault,
      snapOnStep,
      small: eventWithOptionalKeyState?.altKey ?? false,
      clamp: shouldClampValue
    });

    // Notify about a change even when the numeric value is unchanged for input reasons: the
    // typed text may clamp/snap to the current value, or differ while validation normalizes
    // it back to the existing value.
    const shouldFireChange = validatedValue !== value || isInputReason && (unvalidatedValue !== value || allowInputSyncRef.current === false);
    if (shouldFireChange) {
      onValueChangeProp?.(validatedValue, details);
      if (details.isCanceled) {
        // Report a vetoed change as not applied, so callers don't commit a value never stored.
        return false;
      }
      setValueUnwrapped(validatedValue);
      setDirty(validatedValue !== validityData.initialValue);
      hasPendingCommitRef.current = true;
    }
    lastChangedValueRef.current = validatedValue;

    // Keep the visible input in sync immediately when programmatic changes occur
    // (increment/decrement, wheel, etc). During direct typing we don't want
    // to overwrite the user-provided text until blur, so we gate on
    // `allowInputSyncRef`.
    if (allowInputSyncRef.current) {
      setInputValue(formatNumber(validatedValue, locale, format));
    }

    // Formatting can change even if the numeric value hasn't, so ensure a re-render when needed.
    forceRender();
    return shouldFireChange;
  });
  const incrementValue = useStableCallback((amount, {
    direction,
    currentValue,
    event,
    reason
  }) => {
    const prevValue = currentValue == null ? valueRef.current : currentValue;
    const nativeEvent = event;
    if (typeof prevValue !== 'number') {
      // Seed an empty field with 0; `setValue` clamps it to the in-range value nearest 0
      // (e.g. `max` for a negative range). No `direction`: the seed isn't a step, so it must
      // not be directionally snapped.
      return setValue(0, createChangeEventDetails(reason, nativeEvent));
    }
    return setValue(prevValue + amount * direction, createChangeEventDetails(reason, nativeEvent, undefined, {
      direction
    }));
  });

  // We need to update the input value when the external `value` prop changes. This ends up acting
  // as a single source of truth to update the input value, bypassing the need to manually set it in
  // each event handler.
  // This is done inside a layout effect as an alternative to the technique to set state during
  // render as we're accessing a ref, which must be inside an effect.
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  //
  // ESLint is disabled because it needs to run even if the parsed value hasn't changed, since the
  // value still can be formatted differently.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useIsoLayoutEffect(function syncFormattedInputValueOnValueChange() {
    // This ensures the value is only updated on blur rather than every keystroke, but still
    // allows the input value to be updated when the value is changed externally.
    if (!allowInputSyncRef.current) {
      return;
    }
    const nextInputValue = formatNumber(value, locale, format);
    if (nextInputValue !== inputValue) {
      setInputValue(nextInputValue);
    }
  });
  useIsoLayoutEffect(function setDynamicInputModeForIOS() {
    if (!platform.os.ios) {
      return;
    }

    // iOS numeric software keyboard doesn't have a minus key, so we need to use the default
    // keyboard to let the user input a negative number.
    let computedInputMode = 'text';
    if (minWithDefault >= 0) {
      // iOS numeric software keyboard doesn't have a decimal key for "numeric" input mode, but
      // this is better than the "text" input if possible to use.
      computedInputMode = 'decimal';
    }
    setInputMode(computedInputMode);
  }, [minWithDefault]);

  // React attaches `onWheel` as a passive listener, so calling `preventDefault` there is ignored.
  // Attach a native (non-passive) `wheel` listener to the input instead to prevent page scrolling.
  React.useEffect(function registerElementWheelListener() {
    const element = inputRef.current;
    if (disabled || readOnly || !allowWheelScrub || !element) {
      return undefined;
    }
    function handleWheel(event) {
      if (
      // Allow pinch-zooming.
      event.ctrlKey || activeElement(ownerDocument(inputRef.current)) !== inputRef.current) {
        return;
      }

      // Prevent the default behavior to avoid scrolling the page.
      event.preventDefault();
      allowInputSyncRef.current = true;
      const amount = getStepAmount(event);

      // Each wheel turn is a discrete, final change, so commit it immediately like keyboard
      // steps (gated on an actual change so boundary no-ops don't commit).
      const changed = incrementValue(amount, {
        direction: event.deltaY > 0 ? -1 : 1,
        event,
        reason: 'wheel'
      });
      if (changed) {
        onValueCommitted(lastChangedValueRef.current ?? valueRef.current, createGenericEventDetails(REASONS.wheel, event));
      }
    }
    return addEventListener(element, 'wheel', handleWheel);
  }, [allowWheelScrub, incrementValue, disabled, readOnly, getStepAmount, onValueCommitted, lastChangedValueRef, valueRef]);
  const state = React.useMemo(() => ({
    ...fieldState,
    disabled,
    readOnly,
    required,
    value,
    inputValue,
    scrubbing: isScrubbing
  }), [fieldState, disabled, readOnly, required, value, inputValue, isScrubbing]);
  const contextValue = React.useMemo(() => ({
    inputRef,
    inputValue,
    value,
    minWithDefault,
    maxWithDefault,
    disabled,
    readOnly,
    id,
    setValue,
    incrementValue,
    getStepAmount,
    allowInputSyncRef,
    formatOptionsRef,
    valueRef,
    lastChangedValueRef,
    hasPendingCommitRef,
    name,
    nameProp,
    required,
    invalid,
    inputMode,
    getAllowedNonNumericKeys,
    min,
    max,
    setInputValue,
    locale,
    isScrubbing,
    setIsScrubbing,
    state,
    onValueCommitted
  }), [inputRef, inputValue, value, minWithDefault, maxWithDefault, disabled, readOnly, id, setValue, incrementValue, getStepAmount, formatOptionsRef, valueRef, name, nameProp, required, invalid, inputMode, getAllowedNonNumericKeys, min, max, setInputValue, locale, isScrubbing, state, onValueCommitted]);
  const element = useRenderElement('div', componentProps, {
    ref: forwardedRef,
    state,
    props: elementProps,
    stateAttributesMapping
  });
  return /*#__PURE__*/_jsxs(NumberFieldRootContext.Provider, {
    value: contextValue,
    children: [element, /*#__PURE__*/_jsx("input", {
      ...validation.getValidationProps(disabled, {
        onFocus() {
          inputRef.current?.focus();
        },
        onChange(event) {
          // Workaround for https://github.com/facebook/react/issues/9023
          if (event.nativeEvent.defaultPrevented || disabled || readOnly) {
            return;
          }

          // Handle browser autofill.
          const nextValue = event.currentTarget.valueAsNumber;
          const parsedValue = Number.isNaN(nextValue) ? null : nextValue;
          const details = createChangeEventDetails(REASONS.none, event.nativeEvent);

          // `setValue` updates the dirty flag from the stored (clamped) value, so validate with
          // that same value rather than the raw autofilled one.
          setValue(parsedValue, details);
          clearErrors(name);
          validation.change(lastChangedValueRef.current ?? parsedValue);
        }
      }),
      ref: hiddenInputRef,
      type: "number",
      form: form,
      name: name,
      value: value ?? '',
      min: min,
      max: max
      // stepMismatch validation is broken unless an explicit `min` is added.
      // See https://github.com/facebook/react/issues/12334.
      ,
      step: stepProp,
      disabled: disabled,
      readOnly: readOnly,
      required: required,
      "aria-hidden": true,
      tabIndex: -1,
      style: name ? visuallyHiddenInput : visuallyHidden,
      suppressHydrationWarning: true
    })]
  });
});
if (process.env.NODE_ENV !== "production") NumberFieldRoot.displayName = "NumberFieldRoot"; // `none` is kept for consistency with other components even though the number field never
// commits with it.