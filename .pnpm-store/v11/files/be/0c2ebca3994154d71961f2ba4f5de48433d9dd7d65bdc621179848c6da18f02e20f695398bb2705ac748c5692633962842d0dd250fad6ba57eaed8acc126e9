"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Form = void 0;
var React = _interopRequireWildcard(require("react"));
var _useStableCallback = require("@base-ui/utils/useStableCallback");
var _empty = require("@base-ui/utils/empty");
var _createBaseUIEventDetails = require("../internals/createBaseUIEventDetails");
var _reasons = require("../internals/reasons");
var _FormContext = require("../internals/form-context/FormContext");
var _useRenderElement = require("../internals/useRenderElement");
var _useValueChanged = require("../internals/useValueChanged");
var _jsxRuntime = require("react/jsx-runtime");
/**
 * A native form element with consolidated error handling.
 * Renders a `<form>` element.
 *
 * Documentation: [Base UI Form](https://base-ui.com/react/components/form)
 */
const Form = exports.Form = /*#__PURE__*/React.forwardRef(function Form(componentProps, forwardedRef) {
  const {
    render,
    className,
    validationMode = 'onSubmit',
    errors: externalErrors,
    onSubmit,
    onFormSubmit,
    actionsRef,
    style,
    ...elementProps
  } = componentProps;
  const formRef = React.useRef({
    fields: new Map()
  });
  const submittedRef = React.useRef(false);
  const submitAttemptedRef = React.useRef(false);
  const focusControl = (0, _useStableCallback.useStableCallback)(control => {
    if (!control) {
      return;
    }
    control.focus();
    if (control.tagName === 'INPUT') {
      control.select();
    }
  });
  const [errors, setErrors] = React.useState(externalErrors);
  (0, _useValueChanged.useValueChanged)(externalErrors, () => {
    setErrors(externalErrors);
  });
  React.useEffect(() => {
    if (!submittedRef.current) {
      return;
    }
    submittedRef.current = false;
    const invalidFields = Array.from(formRef.current.fields.values()).filter(field => field.validityData.state.valid === false);
    if (invalidFields.length) {
      focusControl(invalidFields[0].controlRef.current);
    }
  }, [errors, focusControl]);
  const handleImperativeValidate = React.useCallback(fieldName => {
    const values = Array.from(formRef.current.fields.values());
    if (fieldName) {
      const namedField = values.find(field => field.name === fieldName);
      if (namedField) {
        namedField.validate();
      }
    } else {
      values.forEach(field => {
        field.validate();
      });
    }
  }, []);
  React.useImperativeHandle(actionsRef, () => ({
    validate: handleImperativeValidate
  }), [handleImperativeValidate]);
  const element = (0, _useRenderElement.useRenderElement)('form', componentProps, {
    ref: forwardedRef,
    props: [{
      noValidate: true,
      onSubmit(event) {
        submitAttemptedRef.current = true;
        let values = Array.from(formRef.current.fields.values());

        // Async validation isn't supported to stop the submit event.
        values.forEach(field => {
          field.validate();
        });
        values = Array.from(formRef.current.fields.values());
        const invalidField = values.find(field => field.validityData.state.valid === false);
        if (invalidField) {
          event.preventDefault();
          focusControl(invalidField.controlRef.current);
        } else {
          submittedRef.current = true;
          onSubmit?.(event);
          if (onFormSubmit) {
            event.preventDefault();
            const formValues = values.reduce((acc, field) => {
              if (field.name) {
                acc[field.name] = field.getValue();
              }
              return acc;
            }, {});
            onFormSubmit(formValues, (0, _createBaseUIEventDetails.createGenericEventDetails)(_reasons.REASONS.none, event.nativeEvent));
          }
        }
      }
    }, elementProps]
  });
  const clearErrors = (0, _useStableCallback.useStableCallback)(name => {
    if (name && errors && _empty.EMPTY_OBJECT.hasOwnProperty.call(errors, name)) {
      const nextErrors = {
        ...errors
      };
      delete nextErrors[name];
      setErrors(nextErrors);
    }
  });
  const contextValue = React.useMemo(() => ({
    formRef,
    validationMode,
    errors: errors ?? _empty.EMPTY_OBJECT,
    clearErrors,
    submitAttemptedRef
  }), [formRef, validationMode, errors, clearErrors]);
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_FormContext.FormContext.Provider, {
    value: contextValue,
    children: element
  });
});
if (process.env.NODE_ENV !== "production") Form.displayName = "Form";