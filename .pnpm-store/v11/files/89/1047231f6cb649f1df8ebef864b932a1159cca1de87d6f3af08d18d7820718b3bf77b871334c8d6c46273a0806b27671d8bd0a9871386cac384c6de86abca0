"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = Icon;
var React = _interopRequireWildcard(require("react"));
var _context = _interopRequireDefault(require("../context"));
var _clsx = require("clsx");
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
function Icon({
  icon,
  ...restProps
}) {
  const {
    prefixCls,
    classNames,
    styles
  } = React.useContext(_context.default);
  return icon ? /*#__PURE__*/React.createElement("span", _extends({
    className: (0, _clsx.clsx)(`${prefixCls}-suffix`, classNames.suffix),
    style: styles.suffix
  }, restProps), icon) : null;
}