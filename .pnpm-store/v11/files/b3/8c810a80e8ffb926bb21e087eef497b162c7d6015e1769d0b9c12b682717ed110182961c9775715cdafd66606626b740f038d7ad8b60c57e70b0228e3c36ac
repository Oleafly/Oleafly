"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ToggleGroupContext = void 0;
exports.useToggleGroupContext = useToggleGroupContext;
var _formatErrorMessage2 = _interopRequireDefault(require("@base-ui/utils/formatErrorMessage"));
var React = _interopRequireWildcard(require("react"));
const ToggleGroupContext = exports.ToggleGroupContext = /*#__PURE__*/React.createContext(undefined);
if (process.env.NODE_ENV !== "production") ToggleGroupContext.displayName = "ToggleGroupContext";
function useToggleGroupContext(optional = true) {
  const context = React.useContext(ToggleGroupContext);
  if (context === undefined && !optional) {
    throw new Error(process.env.NODE_ENV !== "production" ? 'Base UI: ToggleGroupContext is missing. ToggleGroup parts must be placed within <ToggleGroup>.' : (0, _formatErrorMessage2.default)(7));
  }
  return context;
}