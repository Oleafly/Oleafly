"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = Footer;
var _clsx = require("clsx");
var React = _interopRequireWildcard(require("react"));
var _useTimeInfo = _interopRequireDefault(require("../../hooks/useTimeInfo"));
var _context = _interopRequireDefault(require("../context"));
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function Footer(props) {
  const {
    mode,
    internalMode,
    renderExtraFooter,
    showNow,
    showTime,
    onSubmit,
    onNow,
    invalid,
    needConfirm,
    generateConfig,
    disabledDate
  } = props;
  const {
    prefixCls,
    locale,
    button: Button = 'button',
    classNames,
    styles
  } = React.useContext(_context.default);

  // >>> Now
  const now = generateConfig.getNow();
  const [getValidTime] = (0, _useTimeInfo.default)(generateConfig, showTime, now);

  // ======================== Extra =========================
  const extraNode = renderExtraFooter?.(mode);

  // ======================== Ranges ========================
  const nowDisabled = disabledDate(now, {
    type: mode
  });
  const onInternalNow = () => {
    if (!nowDisabled) {
      const validateNow = getValidTime(now);
      onNow(validateNow);
    }
  };
  const nowPrefixCls = `${prefixCls}-now`;
  const nowBtnPrefixCls = `${nowPrefixCls}-btn`;
  const presetNode = showNow && /*#__PURE__*/React.createElement("li", {
    className: nowPrefixCls
  }, /*#__PURE__*/React.createElement("a", {
    className: (0, _clsx.clsx)(nowBtnPrefixCls, nowDisabled && `${nowBtnPrefixCls}-disabled`),
    "aria-disabled": nowDisabled,
    onClick: onInternalNow
  }, internalMode === 'date' ? locale.today : locale.now));

  // >>> OK
  const okNode = needConfirm && /*#__PURE__*/React.createElement("li", {
    className: `${prefixCls}-ok`
  }, /*#__PURE__*/React.createElement(Button, {
    disabled: invalid,
    onClick: onSubmit
  }, locale.ok));
  const rangeNode = (presetNode || okNode) && /*#__PURE__*/React.createElement("ul", {
    className: `${prefixCls}-ranges`
  }, presetNode, okNode);

  // ======================== Render ========================
  if (!extraNode && !rangeNode) {
    return null;
  }
  return /*#__PURE__*/React.createElement("div", {
    className: (0, _clsx.clsx)(`${prefixCls}-footer`, classNames.popup.footer),
    style: styles.popup.footer
  }, extraNode && /*#__PURE__*/React.createElement("div", {
    className: `${prefixCls}-footer-extra`
  }, extraNode), rangeNode);
}