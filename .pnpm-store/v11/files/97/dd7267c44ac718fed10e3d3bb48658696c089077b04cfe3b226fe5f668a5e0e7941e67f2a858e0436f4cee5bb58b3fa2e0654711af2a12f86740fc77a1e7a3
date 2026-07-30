"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.DrawerProviderContext = void 0;
exports.useDrawerProviderContext = useDrawerProviderContext;
var _formatErrorMessage2 = _interopRequireDefault(require("@base-ui/utils/formatErrorMessage"));
var React = _interopRequireWildcard(require("react"));
const DrawerProviderContext = exports.DrawerProviderContext = /*#__PURE__*/React.createContext(undefined);
if (process.env.NODE_ENV !== "production") DrawerProviderContext.displayName = "DrawerProviderContext";
function useDrawerProviderContext(optional) {
  const context = React.useContext(DrawerProviderContext);
  if (optional === false && context === undefined) {
    throw new Error(process.env.NODE_ENV !== "production" ? 'Base UI: DrawerProviderContext is missing. Use <Drawer.Provider>.' : (0, _formatErrorMessage2.default)(91));
  }
  return context;
}