"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SelectRootContext = exports.SelectFloatingContext = void 0;
exports.useSelectFloatingContext = useSelectFloatingContext;
exports.useSelectRootContext = useSelectRootContext;
var _formatErrorMessage2 = _interopRequireDefault(require("@base-ui/utils/formatErrorMessage"));
var React = _interopRequireWildcard(require("react"));
const SelectRootContext = exports.SelectRootContext = /*#__PURE__*/React.createContext(null);
if (process.env.NODE_ENV !== "production") SelectRootContext.displayName = "SelectRootContext";
const SelectFloatingContext = exports.SelectFloatingContext = /*#__PURE__*/React.createContext(null);
if (process.env.NODE_ENV !== "production") SelectFloatingContext.displayName = "SelectFloatingContext";
function useSelectRootContext() {
  const context = React.useContext(SelectRootContext);
  if (context === null) {
    throw new Error(process.env.NODE_ENV !== "production" ? 'Base UI: SelectRootContext is missing. Select parts must be placed within <Select.Root>.' : (0, _formatErrorMessage2.default)(60));
  }
  return context;
}
function useSelectFloatingContext() {
  const context = React.useContext(SelectFloatingContext);
  if (context === null) {
    throw new Error(process.env.NODE_ENV !== "production" ? 'Base UI: SelectFloatingContext is missing. Select parts must be placed within <Select.Root>.' : (0, _formatErrorMessage2.default)(61));
  }
  return context;
}