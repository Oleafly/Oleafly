'use client';

import * as React from 'react';
import { ownerDocument } from '@base-ui/utils/owner';
import { useControlled } from '@base-ui/utils/useControlled';
import { useStableCallback } from '@base-ui/utils/useStableCallback';
import { useValueAsRef } from '@base-ui/utils/useValueAsRef';
import { useIsoLayoutEffect } from '@base-ui/utils/useIsoLayoutEffect';
import { warn } from '@base-ui/utils/warn';
import { createChangeEventDetails, createGenericEventDetails } from "../../internals/createBaseUIEventDetails.mjs";
import { useValueChanged } from "../../internals/useValueChanged.mjs";
import { useBaseUiId } from "../../internals/useBaseUiId.mjs";
import { useRenderElement } from "../../internals/useRenderElement.mjs";
import { clamp } from "../../internals/clamp.mjs";
import { areArraysEqual } from "../../internals/areArraysEqual.mjs";
import { activeElement, contains } from "../../floating-ui-react/utils.mjs";
import { CompositeList } from "../../internals/composite/list/CompositeList.mjs";
import { useFieldRootContext } from "../../internals/field-root-context/FieldRootContext.mjs";
import { useRegisterFieldControl } from "../../internals/field-register-control/useRegisterFieldControl.mjs";
import { useFormContext } from "../../internals/form-context/FormContext.mjs";
import { useLabelableContext } from "../../internals/labelable-provider/LabelableContext.mjs";
import { resolveAriaLabelledBy, getDefaultLabelId } from "../../utils/resolveAriaLabelledBy.mjs";
import { asc } from "../utils/asc.mjs";
import { getSliderValue } from "../utils/getSliderValue.mjs";
import { validateMinimumDistance } from "../utils/validateMinimumDistance.mjs";
import { sliderStateAttributesMapping } from "./stateAttributesMapping.mjs";
import { SliderRootContext } from "./SliderRootContext.mjs";
import { REASONS } from "../../internals/reasons.mjs";
import { jsx as _jsx } from "react/jsx-runtime";
function getSliderChangeEventReason(event) {
  return 'key' in event ? REASONS.keyboard : REASONS.inputChange;
}
function areValuesEqual(newValue, oldValue) {
  if (typeof newValue === 'number' && typeof oldValue === 'number') {
    return newValue === oldValue;
  }
  if (Array.isArray(newValue) && Array.isArray(oldValue)) {
    return areArraysEqual(newValue, oldValue);
  }
  return false;
}

/**
 * Groups all parts of the slider.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Slider](https://base-ui.com/react/components/slider)
 */
export const SliderRoot = /*#__PURE__*/React.forwardRef(function SliderRoot(componentProps, forwardedRef) {
  const {
    'aria-labelledby': ariaLabelledByProp,
    className,
    defaultValue,
    disabled: disabledProp = false,
    id: idProp,
    format,
    largeStep = 10,
    locale,
    render,
    max = 100,
    min = 0,
    minStepsBetweenValues = 0,
    form,
    name: nameProp,
    onValueChange: onValueChangeProp,
    onValueCommitted: onValueCommittedProp,
    orientation = 'horizontal',
    step = 1,
    thumbCollisionBehavior = 'push',
    thumbAlignment = 'center',
    value: valueProp,
    style,
    ...elementProps
  } = componentProps;
  const id = useBaseUiId(idProp);
  const defaultLabelId = getDefaultLabelId(id);
  const onValueChange = useStableCallback(onValueChangeProp);
  const onValueCommitted = useStableCallback(onValueCommittedProp);
  const {
    clearErrors
  } = useFormContext();
  const {
    state: fieldState,
    disabled: fieldDisabled,
    name: fieldName,
    setTouched,
    setDirty,
    validityData,
    validation
  } = useFieldRootContext();
  const {
    labelId: fieldLabelId
  } = useLabelableContext();
  const [labelId, setLabelId] = React.useState();
  const ariaLabelledby = ariaLabelledByProp ?? resolveAriaLabelledBy(fieldLabelId, labelId);
  const disabled = fieldDisabled || disabledProp;
  const name = fieldName ?? nameProp;

  // The internal value is potentially unsorted, e.g. to support frozen arrays
  // https://github.com/mui/material-ui/pull/28472
  const [valueUnwrapped, setValueUnwrapped] = useControlled({
    controlled: valueProp,
    default: defaultValue ?? min,
    name: 'Slider'
  });
  const sliderRef = React.useRef(null);
  const controlRef = React.useRef(null);
  const thumbRefs = React.useRef([]);
  // The input element nested in the pressed thumb.
  const pressedInputRef = React.useRef(null);
  // The px distance between the pointer and the center of a pressed thumb.
  const pressedThumbCenterOffsetRef = React.useRef(null);
  // The index of the pressed thumb, or the closest thumb if the `Control` was pressed.
  // This is updated on pointerdown, which is sooner than the `active/activeIndex`
  // state which is updated later when the nested `input` receives focus.
  const pressedThumbIndexRef = React.useRef(-1);
  // The values when the current drag interaction started.
  const pressedValuesRef = React.useRef(null);
  const lastChangeReasonRef = React.useRef('none');
  const formatOptionsRef = useValueAsRef(format);

  // We can't use the :active browser pseudo-classes.
  // - The active state isn't triggered when clicking on the rail.
  // - The active state isn't transferred when inversing a range slider.
  const [active, setActiveState] = React.useState(-1);
  const [lastUsedThumbIndex, setLastUsedThumbIndex] = React.useState(-1);
  const [dragging, setDragging] = React.useState(false);
  const [thumbMap, setThumbMap] = React.useState(() => new Map());
  const [indicatorPosition, setIndicatorPosition] = React.useState([undefined, undefined]);
  const setActive = useStableCallback(value => {
    setActiveState(value);
    if (value !== -1) {
      setLastUsedThumbIndex(value);
    }
  });
  useRegisterFieldControl(validation.inputRef, id, valueUnwrapped, undefined, !disabled, nameProp);
  useValueChanged(valueUnwrapped, () => {
    clearErrors(name);
    validation.change(valueUnwrapped);
    const initialValue = validityData.initialValue;
    let isDirty;
    if (Array.isArray(valueUnwrapped) && Array.isArray(initialValue)) {
      isDirty = !areArraysEqual(valueUnwrapped, initialValue);
    } else {
      isDirty = valueUnwrapped !== initialValue;
    }
    setDirty(isDirty);
  });
  const registerFieldControlRef = useStableCallback(element => {
    if (element) {
      controlRef.current = element;
    }
  });
  const range = Array.isArray(valueUnwrapped);
  const values = React.useMemo(() => {
    if (!range) {
      return [clamp(valueUnwrapped, min, max)];
    }
    return valueUnwrapped.slice().sort(asc);
  }, [max, min, range, valueUnwrapped]);
  const setValue = useStableCallback((newValue, details) => {
    if (Number.isNaN(newValue) || areValuesEqual(newValue, valueUnwrapped)) {
      return false;
    }
    const changeDetails = details ?? createChangeEventDetails(REASONS.none, undefined, undefined, {
      activeThumbIndex: -1
    });

    // Redefine target to allow name and value to be read.
    // This allows seamless integration with the most popular form libraries.
    // https://github.com/mui/material-ui/issues/13485#issuecomment-676048492
    // Clone the event to not override `target` of the original event.
    const nativeEvent = changeDetails.event;
    const EventConstructor = nativeEvent.constructor ?? Event;
    const clonedEvent = new EventConstructor(nativeEvent.type, nativeEvent);
    Object.defineProperty(clonedEvent, 'target', {
      writable: true,
      value: {
        value: newValue,
        name
      }
    });
    changeDetails.event = clonedEvent;
    onValueChange(newValue, changeDetails);
    if (changeDetails.isCanceled) {
      return false;
    }
    lastChangeReasonRef.current = changeDetails.reason;
    setValueUnwrapped(newValue);
    return true;
  });
  const handleInputChange = useStableCallback((valueInput, index, event) => {
    const newValue = getSliderValue(valueInput, index, min, max, range, values);
    if (validateMinimumDistance(newValue, step, minStepsBetweenValues)) {
      const reason = getSliderChangeEventReason(event);
      const applied = setValue(newValue, createChangeEventDetails(reason, event.nativeEvent, undefined, {
        activeThumbIndex: index
      }));
      setTouched(true);
      if (applied) {
        onValueCommitted(newValue, createGenericEventDetails(reason, event.nativeEvent));
      }
    }
  });
  if (process.env.NODE_ENV !== 'production') {
    if (min >= max) {
      warn('Slider `max` must be greater than `min`.');
    }
  }
  useIsoLayoutEffect(() => {
    const activeEl = activeElement(ownerDocument(sliderRef.current));
    if (disabled && contains(sliderRef.current, activeEl)) {
      // This is necessary because Firefox and Safari will keep focus
      // on a disabled element:
      // https://codesandbox.io/p/sandbox/mui-pr-22247-forked-h151h?file=/src/App.js
      activeEl.blur();
    }
  }, [disabled]);
  if (disabled && active !== -1) {
    setActive(-1);
  }
  const state = React.useMemo(() => ({
    ...fieldState,
    activeThumbIndex: active,
    disabled,
    dragging,
    orientation,
    max,
    min,
    minStepsBetweenValues,
    step,
    values
  }), [fieldState, active, disabled, dragging, max, min, minStepsBetweenValues, orientation, step, values]);
  const contextValue = React.useMemo(() => ({
    active,
    controlRef,
    disabled,
    dragging,
    validation,
    formatOptionsRef,
    handleInputChange,
    indicatorPosition,
    inset: thumbAlignment !== 'center',
    labelId: ariaLabelledby,
    rootLabelId: defaultLabelId,
    largeStep,
    lastUsedThumbIndex,
    lastChangeReasonRef,
    form,
    locale,
    max,
    min,
    minStepsBetweenValues,
    name,
    onValueCommitted,
    orientation,
    pressedInputRef,
    pressedThumbCenterOffsetRef,
    pressedThumbIndexRef,
    pressedValuesRef,
    registerFieldControlRef,
    renderBeforeHydration: thumbAlignment === 'edge',
    setActive,
    setDragging,
    setIndicatorPosition,
    setLabelId,
    setValue,
    state,
    step,
    thumbCollisionBehavior,
    thumbMap,
    thumbRefs,
    values
  }), [active, controlRef, ariaLabelledby, defaultLabelId, disabled, dragging, validation, formatOptionsRef, handleInputChange, indicatorPosition, largeStep, lastUsedThumbIndex, lastChangeReasonRef, form, locale, max, min, minStepsBetweenValues, name, onValueCommitted, orientation, pressedInputRef, pressedThumbCenterOffsetRef, pressedThumbIndexRef, pressedValuesRef, registerFieldControlRef, setActive, setDragging, setIndicatorPosition, setLabelId, setValue, state, step, thumbCollisionBehavior, thumbAlignment, thumbMap, thumbRefs, values]);
  const element = useRenderElement('div', componentProps, {
    state,
    ref: [forwardedRef, sliderRef],
    props: [{
      'aria-labelledby': ariaLabelledby,
      id,
      role: 'group'
    }, elementProps, props => validation.getValidationProps(disabled, props)],
    stateAttributesMapping: sliderStateAttributesMapping
  });
  return /*#__PURE__*/_jsx(SliderRootContext.Provider, {
    value: contextValue,
    children: /*#__PURE__*/_jsx(CompositeList, {
      elementsRef: thumbRefs,
      onMapChange: setThumbMap,
      children: element
    })
  });
});
if (process.env.NODE_ENV !== "production") SliderRoot.displayName = "SliderRoot";