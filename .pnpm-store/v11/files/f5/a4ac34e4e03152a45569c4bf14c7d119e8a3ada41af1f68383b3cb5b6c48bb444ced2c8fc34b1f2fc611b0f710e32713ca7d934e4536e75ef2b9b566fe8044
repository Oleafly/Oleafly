"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useRegisterFieldControl = useRegisterFieldControl;
var React = _interopRequireWildcard(require("react"));
var _useIsoLayoutEffect = require("@base-ui/utils/useIsoLayoutEffect");
var _FieldRootContext = require("../field-root-context/FieldRootContext");
function useRegisterFieldControl(controlRef, id, value, getFormValueOverride, enabled = true, name) {
  const {
    registerFieldControl
  } = (0, _FieldRootContext.useFieldRootContext)();
  const sourceRef = React.useRef(null);
  if (!sourceRef.current) {
    sourceRef.current = Symbol();
  }
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    const source = sourceRef.current;
    if (!source || !enabled) {
      return undefined;
    }
    const registration = {
      controlRef,
      getValue: getFormValueOverride,
      id,
      name,
      value
    };
    registerFieldControl(source, registration);
    return () => {
      registerFieldControl(source, undefined);
    };
  }, [controlRef, enabled, getFormValueOverride, id, name, registerFieldControl, value]);
}