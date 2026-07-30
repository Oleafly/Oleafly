"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SliderRoot = void 0;
var React = _interopRequireWildcard(require("react"));
var _owner = require("@base-ui/utils/owner");
var _useControlled = require("@base-ui/utils/useControlled");
var _useStableCallback = require("@base-ui/utils/useStableCallback");
var _useValueAsRef = require("@base-ui/utils/useValueAsRef");
var _useIsoLayoutEffect = require("@base-ui/utils/useIsoLayoutEffect");
var _warn = require("@base-ui/utils/warn");
var _createBaseUIEventDetails = require("../../internals/createBaseUIEventDetails");
var _useValueChanged = require("../../internals/useValueChanged");
var _useBaseUiId = require("../../internals/useBaseUiId");
var _useRenderElement = require("../../internals/useRenderElement");
var _clamp = require("../../internals/clamp");
var _areArraysEqual = require("../../internals/areArraysEqual");
var _utils = require("../../floating-ui-react/utils");
var _CompositeList = require("../../internals/composite/list/CompositeList");
var _FieldRootContext = require("../../internals/field-root-context/FieldRootContext");
var _useRegisterFieldControl = require("../../internals/field-register-control/useRegisterFieldControl");
var _FormContext = require("../../internals/form-context/FormContext");
var _LabelableContext = require("../../internals/labelable-provider/LabelableContext");
var _resolveAriaLabelledBy = require("../../utils/resolveAriaLabelledBy");
var _asc = require("../utils/asc");
var _getSliderValue = require("../utils/getSliderValue");
var _validateMinimumDistance = require("../utils/validateMinimumDistance");
var _stateAttributesMapping = require("./stateAttributesMapping");
var _SliderRootContext = require("./SliderRootContext");
var _reasons = require("../../internals/reasons");
var _jsxRuntime = require("react/jsx-runtime");
function getSliderChangeEventReason(event) {
  return 'key' in event ? _reasons.REASONS.keyboard : _reasons.REASONS.inputChange;
}
function areValuesEqual(newValue, oldValue) {
  if (typeof newValue === 'number' && typeof oldValue === 'number') {
    return newValue === oldValue;
  }
  if (Array.isArray(newValue) && Array.isArray(oldValue)) {
    return (0, _areArraysEqual.areArraysEqual)(newValue, oldValue);
  }
  return false;
}

/**
 * Groups all parts of the slider.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Slider](https://base-ui.com/react/components/slider)
 */
const SliderRoot = exports.SliderRoot = /*#__PURE__*/React.forwardRef(function SliderRoot(componentProps, forwardedRef) {
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
  const id = (0, _useBaseUiId.useBaseUiId)(idProp);
  const defaultLabelId = (0, _resolveAriaLabelledBy.getDefaultLabelId)(id);
  const onValueChange = (0, _useStableCallback.useStableCallback)(onValueChangeProp);
  const onValueCommitted = (0, _useStableCallback.useStableCallback)(onValueCommittedProp);
  const {
    clearErrors
  } = (0, _FormContext.useFormContext)();
  const {
    state: fieldState,
    disabled: fieldDisabled,
    name: fieldName,
    setTouched,
    setDirty,
    validityData,
    validation
  } = (0, _FieldRootContext.useFieldRootContext)();
  const {
    labelId: fieldLabelId
  } = (0, _LabelableContext.useLabelableContext)();
  const [labelId, setLabelId] = React.useState();
  const ariaLabelledby = ariaLabelledByProp ?? (0, _resolveAriaLabelledBy.resolveAriaLabelledBy)(fieldLabelId, labelId);
  const disabled = fieldDisabled || disabledProp;
  const name = fieldName ?? nameProp;

  // The internal value is potentially unsorted, e.g. to support frozen arrays
  // https://github.com/mui/material-ui/pull/28472
  const [valueUnwrapped, setValueUnwrapped] = (0, _useControlled.useControlled)({
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
  const formatOptionsRef = (0, _useValueAsRef.useValueAsRef)(format);

  // We can't use the :active browser pseudo-classes.
  // - The active state isn't triggered when clicking on the rail.
  // - The active state isn't transferred when inversing a range slider.
  const [active, setActiveState] = React.useState(-1);
  const [lastUsedThumbIndex, setLastUsedThumbIndex] = React.useState(-1);
  const [dragging, setDragging] = React.useState(false);
  const [thumbMap, setThumbMap] = React.useState(() => new Map());
  const [indicatorPosition, setIndicatorPosition] = React.useState([undefined, undefined]);
  const setActive = (0, _useStableCallback.useStableCallback)(value => {
    setActiveState(value);
    if (value !== -1) {
      setLastUsedThumbIndex(value);
    }
  });
  (0, _useRegisterFieldControl.useRegisterFieldControl)(validation.inputRef, id, valueUnwrapped, undefined, !disabled, nameProp);
  (0, _useValueChanged.useValueChanged)(valueUnwrapped, () => {
    clearErrors(name);
    validation.change(valueUnwrapped);
    const initialValue = validityData.initialValue;
    let isDirty;
    if (Array.isArray(valueUnwrapped) && Array.isArray(initialValue)) {
      isDirty = !(0, _areArraysEqual.areArraysEqual)(valueUnwrapped, initialValue);
    } else {
      isDirty = valueUnwrapped !== initialValue;
    }
    setDirty(isDirty);
  });
  const registerFieldControlRef = (0, _useStableCallback.useStableCallback)(element => {
    if (element) {
      controlRef.current = element;
    }
  });
  const range = Array.isArray(valueUnwrapped);
  const values = React.useMemo(() => {
    if (!range) {
      return [(0, _clamp.clamp)(valueUnwrapped, min, max)];
    }
    return valueUnwrapped.slice().sort(_asc.asc);
  }, [max, min, range, valueUnwrapped]);
  const setValue = (0, _useStableCallback.useStableCallback)((newValue, details) => {
    if (Number.isNaN(newValue) || areValuesEqual(newValue, valueUnwrapped)) {
      return false;
    }
    const changeDetails = details ?? (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.none, undefined, undefined, {
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
  const handleInputChange = (0, _useStableCallback.useStableCallback)((valueInput, index, event) => {
    const newValue = (0, _getSliderValue.getSliderValue)(valueInput, index, min, max, range, values);
    if ((0, _validateMinimumDistance.validateMinimumDistance)(newValue, step, minStepsBetweenValues)) {
      const reason = getSliderChangeEventReason(event);
      const applied = setValue(newValue, (0, _createBaseUIEventDetails.createChangeEventDetails)(reason, event.nativeEvent, undefined, {
        activeThumbIndex: index
      }));
      setTouched(true);
      if (applied) {
        onValueCommitted(newValue, (0, _createBaseUIEventDetails.createGenericEventDetails)(reason, event.nativeEvent));
      }
    }
  });
  if (process.env.NODE_ENV !== 'production') {
    if (min >= max) {
      (0, _warn.warn)('Slider `max` must be greater than `min`.');
    }
  }
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    const activeEl = (0, _utils.activeElement)((0, _owner.ownerDocument)(sliderRef.current));
    if (disabled && (0, _utils.contains)(sliderRef.current, activeEl)) {
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
  const element = (0, _useRenderElement.useRenderElement)('div', componentProps, {
    state,
    ref: [forwardedRef, sliderRef],
    props: [{
      'aria-labelledby': ariaLabelledby,
      id,
      role: 'group'
    }, elementProps, props => validation.getValidationProps(disabled, props)],
    stateAttributesMapping: _stateAttributesMapping.sliderStateAttributesMapping
  });
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_SliderRootContext.SliderRootContext.Provider, {
    value: contextValue,
    children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_CompositeList.CompositeList, {
      elementsRef: thumbRefs,
      onMapChange: setThumbMap,
      children: element
    })
  });
});
if (process.env.NODE_ENV !== "production") SliderRoot.displayName = "SliderRoot";