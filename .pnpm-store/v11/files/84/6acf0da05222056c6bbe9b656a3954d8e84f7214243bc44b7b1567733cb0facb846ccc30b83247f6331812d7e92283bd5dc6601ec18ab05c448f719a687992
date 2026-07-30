"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var React = _interopRequireWildcard(require("react"));
var _resizeObserver = _interopRequireDefault(require("@rc-component/resize-observer"));
var _clsx = require("clsx");
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
/**
 * Fill component to provided the scroll content real height.
 */
const Filler = /*#__PURE__*/React.forwardRef(({
  height,
  offsetY,
  offsetX,
  children,
  prefixCls,
  onInnerResize,
  innerProps,
  rtl,
  extra
}, ref) => {
  let outerStyle = {};
  let innerStyle = {
    display: 'flex',
    flexDirection: 'column'
  };
  if (offsetY !== undefined) {
    // Not set `width` since this will break `sticky: right`
    outerStyle = {
      height,
      position: 'relative',
      overflow: 'hidden'
    };
    innerStyle = {
      ...innerStyle,
      transform: `translateY(${offsetY}px)`,
      [rtl ? 'marginRight' : 'marginLeft']: -offsetX,
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0
    };
  }
  return /*#__PURE__*/React.createElement("div", {
    style: outerStyle
  }, /*#__PURE__*/React.createElement(_resizeObserver.default, {
    onResize: ({
      offsetHeight
    }) => {
      if (offsetHeight && onInnerResize) {
        onInnerResize();
      }
    }
  }, /*#__PURE__*/React.createElement("div", _extends({
    style: innerStyle,
    className: (0, _clsx.clsx)({
      [`${prefixCls}-holder-inner`]: prefixCls
    }),
    ref: ref
  }, innerProps), children, extra)));
});
Filler.displayName = 'Filler';
var _default = exports.default = Filler;