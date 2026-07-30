"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.CheckboxGroup = void 0;
var React = _interopRequireWildcard(require("react"));
var _useControlled = require("@base-ui/utils/useControlled");
var _useStableCallback = require("@base-ui/utils/useStableCallback");
var _empty = require("@base-ui/utils/empty");
var _useBaseUiId = require("../internals/useBaseUiId");
var _useRenderElement = require("../internals/useRenderElement");
var _CheckboxGroupContext = require("./CheckboxGroupContext");
var _FieldRootContext = require("../internals/field-root-context/FieldRootContext");
var _useRegisterFieldControl = require("../internals/field-register-control/useRegisterFieldControl");
var _LabelableContext = require("../internals/labelable-provider/LabelableContext");
var _constants = require("../internals/field-constants/constants");
var _CheckboxRoot = require("../checkbox/root/CheckboxRoot");
var _useCheckboxGroupParent = require("./useCheckboxGroupParent");
var _FormContext = require("../internals/form-context/FormContext");
var _useValueChanged = require("../internals/useValueChanged");
var _areArraysEqual = require("../internals/areArraysEqual");
var _jsxRuntime = require("react/jsx-runtime");
/**
 * Provides a shared state to a series of checkboxes.
 *
 * Documentation: [Base UI Checkbox Group](https://base-ui.com/react/components/checkbox-group)
 */
const CheckboxGroup = exports.CheckboxGroup = /*#__PURE__*/React.forwardRef(function CheckboxGroup(componentProps, forwardedRef) {
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
  } = (0, _FieldRootContext.useFieldRootContext)();
  const {
    labelId,
    getDescriptionProps
  } = (0, _LabelableContext.useLabelableContext)();
  const {
    clearErrors
  } = (0, _FormContext.useFormContext)();
  const disabled = fieldDisabled || disabledProp;
  const defaultValue = React.useMemo(() => {
    if (externalValue === undefined) {
      return defaultValueProp ?? [];
    }
    return undefined;
  }, [externalValue, defaultValueProp]);
  const [value, setValueUnwrapped] = (0, _useControlled.useControlled)({
    controlled: externalValue,
    default: defaultValue,
    name: 'CheckboxGroup',
    state: 'value'
  });
  const setValue = (0, _useStableCallback.useStableCallback)((v, eventDetails) => {
    onValueChange?.(v, eventDetails);
    if (eventDetails.isCanceled) {
      return;
    }
    setValueUnwrapped(v);
  });
  const parent = (0, _useCheckboxGroupParent.useCheckboxGroupParent)({
    allValues,
    value,
    onValueChange: setValue
  });
  const id = (0, _useBaseUiId.useBaseUiId)(idProp);
  const controlRef = React.useRef(null);
  const registerControlRef = React.useCallback(element => {
    if (controlRef.current == null && element != null && !element.hasAttribute(_CheckboxRoot.PARENT_CHECKBOX)) {
      controlRef.current = element;
    }
  }, []);
  (0, _useRegisterFieldControl.useRegisterFieldControl)(controlRef, id, value, undefined, !!fieldName && !disabled, fieldName);
  const resolvedValue = value ?? _empty.EMPTY_ARRAY;
  (0, _useValueChanged.useValueChanged)(resolvedValue, () => {
    if (fieldName) {
      clearErrors(fieldName);
    }
    const initialValue = Array.isArray(validityData.initialValue) ? validityData.initialValue : _empty.EMPTY_ARRAY;
    setFilled(resolvedValue.length > 0);
    setDirty(!(0, _areArraysEqual.areArraysEqual)(resolvedValue, initialValue));
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
  const element = (0, _useRenderElement.useRenderElement)('div', componentProps, {
    state,
    ref: forwardedRef,
    props: [{
      id: idProp,
      role: 'group',
      'aria-labelledby': labelId
    }, elementProps, getDescriptionProps],
    stateAttributesMapping: _constants.fieldValidityMapping
  });
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_CheckboxGroupContext.CheckboxGroupContext.Provider, {
    value: contextValue,
    children: element
  });
});
if (process.env.NODE_ENV !== "production") CheckboxGroup.displayName = "CheckboxGroup";