"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.FieldControl = void 0;
var React = _interopRequireWildcard(require("react"));
var _useControlled = require("@base-ui/utils/useControlled");
var _useIsoLayoutEffect = require("@base-ui/utils/useIsoLayoutEffect");
var _owner = require("@base-ui/utils/owner");
var _useStableCallback = require("@base-ui/utils/useStableCallback");
var _FieldRootContext = require("../../internals/field-root-context/FieldRootContext");
var _useRegisterFieldControl = require("../../internals/field-register-control/useRegisterFieldControl");
var _FormContext = require("../../internals/form-context/FormContext");
var _LabelableContext = require("../../internals/labelable-provider/LabelableContext");
var _useLabelableId = require("../../internals/labelable-provider/useLabelableId");
var _constants = require("../../internals/field-constants/constants");
var _useRenderElement = require("../../internals/useRenderElement");
var _createBaseUIEventDetails = require("../../internals/createBaseUIEventDetails");
var _reasons = require("../../internals/reasons");
var _utils = require("../../floating-ui-react/utils");
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
const FieldControl = exports.FieldControl = /*#__PURE__*/React.forwardRef(function FieldControl(componentProps, forwardedRef) {
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
  } = (0, _FieldRootContext.useFieldRootContext)();
  const {
    clearErrors
  } = (0, _FormContext.useFormContext)();
  const disabled = fieldDisabled || disabledProp;
  const name = fieldName ?? nameProp;
  const state = {
    ...fieldState,
    disabled
  };
  const {
    labelId
  } = (0, _LabelableContext.useLabelableContext)();
  const id = (0, _useLabelableId.useLabelableId)({
    id: idProp
  });
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    const hasExternalValue = valueProp != null;
    if (validation.inputRef.current?.value || hasExternalValue && valueProp !== '') {
      setFilled(true);
    } else if (hasExternalValue && valueProp === '') {
      setFilled(false);
    }
  }, [validation.inputRef, setFilled, valueProp]);
  const inputRef = React.useRef(null);
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    if (autoFocus && inputRef.current === (0, _utils.activeElement)((0, _owner.ownerDocument)(inputRef.current))) {
      setFocused(true);
    }
  }, [autoFocus, setFocused]);
  const [valueUnwrapped] = (0, _useControlled.useControlled)({
    controlled: valueProp,
    default: defaultValue,
    name: 'FieldControl',
    state: 'value'
  });
  const isControlled = valueProp !== undefined;
  const value = isControlled ? valueUnwrapped : undefined;
  const getValueFromInput = (0, _useStableCallback.useStableCallback)(() => validation.inputRef.current?.value);
  (0, _useRegisterFieldControl.useRegisterFieldControl)(validation.inputRef, id, value, getValueFromInput, !disabled, nameProp);
  const element = (0, _useRenderElement.useRenderElement)('input', componentProps, {
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
        onValueChange?.(inputValue, (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.none, event.nativeEvent));
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
    stateAttributesMapping: _constants.fieldValidityMapping
  });
  return element;
});
if (process.env.NODE_ENV !== "production") FieldControl.displayName = "FieldControl";