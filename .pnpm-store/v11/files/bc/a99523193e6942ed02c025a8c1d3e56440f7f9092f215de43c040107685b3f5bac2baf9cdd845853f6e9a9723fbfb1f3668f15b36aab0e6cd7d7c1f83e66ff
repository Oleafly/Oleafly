"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ToolbarGroupContext = void 0;
exports.useToolbarGroupContext = useToolbarGroupContext;
var _formatErrorMessage2 = _interopRequireDefault(require("@base-ui/utils/formatErrorMessage"));
var React = _interopRequireWildcard(require("react"));
const ToolbarGroupContext = exports.ToolbarGroupContext = /*#__PURE__*/React.createContext(undefined);
if (process.env.NODE_ENV !== "production") ToolbarGroupContext.displayName = "ToolbarGroupContext";
function useToolbarGroupContext(optional) {
  const context = React.useContext(ToolbarGroupContext);
  if (context === undefined && !optional) {
    throw new Error(process.env.NODE_ENV !== "production" ? 'Base UI: ToolbarGroupContext is missing. ToolbarGroup parts must be placed within <Toolbar.Group>.' : (0, _formatErrorMessage2.default)(68));
  }
  return context;
}