"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.DrawerViewportContext = void 0;
exports.useDrawerViewportContext = useDrawerViewportContext;
var _formatErrorMessage2 = _interopRequireDefault(require("@base-ui/utils/formatErrorMessage"));
var React = _interopRequireWildcard(require("react"));
const DrawerViewportContext = exports.DrawerViewportContext = /*#__PURE__*/React.createContext(null);
if (process.env.NODE_ENV !== "production") DrawerViewportContext.displayName = "DrawerViewportContext";
function useDrawerViewportContext(optional) {
  const context = React.useContext(DrawerViewportContext);
  if (optional === false && context === null) {
    throw new Error(process.env.NODE_ENV !== "production" ? 'Base UI: DrawerViewportContext is missing. Drawer parts must be placed within <Drawer.Viewport>.' : (0, _formatErrorMessage2.default)(92));
  }
  return context;
}