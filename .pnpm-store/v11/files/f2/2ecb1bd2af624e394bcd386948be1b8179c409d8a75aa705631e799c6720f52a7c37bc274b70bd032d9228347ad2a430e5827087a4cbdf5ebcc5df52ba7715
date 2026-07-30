"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useStateAttributesMapping = useStateAttributesMapping;
var React = _interopRequireWildcard(require("react"));
var _CheckboxRootDataAttributes = require("../root/CheckboxRootDataAttributes");
var _constants = require("../../internals/field-constants/constants");
function useStateAttributesMapping(state) {
  return React.useMemo(() => ({
    checked(value) {
      if (state.indeterminate) {
        // `data-indeterminate` is already handled by the `indeterminate` prop.
        return {};
      }
      if (value) {
        return {
          [_CheckboxRootDataAttributes.CheckboxRootDataAttributes.checked]: ''
        };
      }
      return {
        [_CheckboxRootDataAttributes.CheckboxRootDataAttributes.unchecked]: ''
      };
    },
    ..._constants.fieldValidityMapping
  }), [state.indeterminate]);
}