"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.CheckboxGroupContext = void 0;
exports.useCheckboxGroupContext = useCheckboxGroupContext;
var _formatErrorMessage2 = _interopRequireDefault(require("@base-ui/utils/formatErrorMessage"));
var React = _interopRequireWildcard(require("react"));
const CheckboxGroupContext = exports.CheckboxGroupContext = /*#__PURE__*/React.createContext(undefined);
if (process.env.NODE_ENV !== "production") CheckboxGroupContext.displayName = "CheckboxGroupContext";
function useCheckboxGroupContext(optional = true) {
  const context = React.useContext(CheckboxGroupContext);
  if (context === undefined && !optional) {
    throw new Error(process.env.NODE_ENV !== "production" ? 'Base UI: CheckboxGroupContext is missing. CheckboxGroup parts must be placed within <CheckboxGroup>.' : (0, _formatErrorMessage2.default)(3));
  }
  return context;
}