"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = PresetPanel;
var React = _interopRequireWildcard(require("react"));
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function executeValue(value) {
  return typeof value === 'function' ? value() : value;
}
function PresetPanel(props) {
  const {
    prefixCls,
    presets,
    onClick,
    onHover
  } = props;
  if (!presets.length) {
    return null;
  }
  return /*#__PURE__*/React.createElement("div", {
    className: `${prefixCls}-presets`
  }, /*#__PURE__*/React.createElement("ul", null, presets.map(({
    label,
    value
  }, index) => /*#__PURE__*/React.createElement("li", {
    key: index,
    onClick: () => {
      onClick(executeValue(value));
    },
    onMouseEnter: () => {
      onHover(executeValue(value));
    },
    onMouseLeave: () => {
      onHover(null);
    }
  }, label))));
}