"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.fillClearIcon = fillClearIcon;
var _util = require("@rc-component/util");
var React = _interopRequireWildcard(require("react"));
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
/**
 * Used for `useFilledProps` since it already in the React.useMemo
 */
function fillClearIcon(prefixCls, allowClear, clearIcon) {
  if (process.env.NODE_ENV !== 'production' && clearIcon) {
    (0, _util.warning)(false, '`clearIcon` will be removed in future. Please use `allowClear` instead.');
  }
  if (allowClear === false) {
    return null;
  }
  const config = allowClear && typeof allowClear === 'object' ? allowClear : {};
  return config.clearIcon || clearIcon || /*#__PURE__*/React.createElement("span", {
    className: `${prefixCls}-clear-btn`
  });
}