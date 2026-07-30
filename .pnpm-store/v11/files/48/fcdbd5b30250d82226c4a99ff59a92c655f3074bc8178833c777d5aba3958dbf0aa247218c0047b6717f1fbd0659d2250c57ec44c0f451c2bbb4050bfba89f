"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _clsx = require("clsx");
var React = _interopRequireWildcard(require("react"));
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
const Content = /*#__PURE__*/React.forwardRef((props, ref) => {
  const {
    listPrefixCls,
    height,
    topNoticeHeight = 0,
    topNoticeWidth = 0,
    className,
    style,
    ...restProps
  } = props;
  const contentPrefixCls = `${listPrefixCls}-content`;

  // ========================= Height =========================
  const prevHeightRef = React.useRef(height);
  const prevHeight = prevHeightRef.current;
  const heightStatus = height < prevHeight ? 'decrease' : 'increase';
  prevHeightRef.current = height;

  // ========================= Style ==========================
  const contentStyle = {
    ...style,
    height,
    '--top-notificiation-height': `${topNoticeHeight}px`,
    '--top-notificiation-width': `${topNoticeWidth}px`
  };

  // ========================= Render =========================
  return /*#__PURE__*/React.createElement("div", _extends({}, restProps, {
    className: (0, _clsx.clsx)(contentPrefixCls, `${contentPrefixCls}-${heightStatus}`, className),
    style: contentStyle,
    ref: ref
  }));
});
if (process.env.NODE_ENV !== 'production') {
  Content.displayName = 'NotificationListContent';
}
var _default = exports.default = Content;