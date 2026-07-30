"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = TimePanel;
var _clsx = require("clsx");
var React = _interopRequireWildcard(require("react"));
var _dateUtil = require("../../utils/dateUtil");
var _context = require("../context");
var _PanelHeader = _interopRequireDefault(require("../PanelHeader"));
var _TimePanelBody = _interopRequireDefault(require("./TimePanelBody"));
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function TimePanel(props) {
  const {
    prefixCls,
    value,
    locale,
    generateConfig,
    // Format
    showTime
  } = props;
  const {
    format
  } = showTime || {};
  const panelPrefixCls = `${prefixCls}-time-panel`;

  // ========================== Base ==========================
  const [info] = (0, _context.useInfo)(props, 'time');

  // ========================= Render =========================
  return /*#__PURE__*/React.createElement(_context.PanelContext.Provider, {
    value: info
  }, /*#__PURE__*/React.createElement("div", {
    className: (0, _clsx.clsx)(panelPrefixCls)
  }, /*#__PURE__*/React.createElement(_PanelHeader.default, null, value ? (0, _dateUtil.formatValue)(value, {
    locale,
    format,
    generateConfig
  }) : '\u00A0'), /*#__PURE__*/React.createElement(_TimePanelBody.default, showTime)));
}