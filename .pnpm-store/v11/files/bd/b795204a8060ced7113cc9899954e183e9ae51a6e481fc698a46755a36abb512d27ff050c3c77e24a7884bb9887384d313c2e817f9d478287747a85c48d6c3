"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _clsx = require("clsx");
var React = _interopRequireWildcard(require("react"));
var _dateUtil = require("../utils/dateUtil");
var _context = require("./context");
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
const HIDDEN_STYLE = {
  visibility: 'hidden'
};
function PanelHeader(props) {
  const {
    offset,
    superOffset,
    onChange,
    getStart,
    getEnd,
    children
  } = props;
  const {
    prefixCls,
    classNames,
    styles,
    // Icons
    prevIcon = '\u2039',
    nextIcon = '\u203A',
    superPrevIcon = '\u00AB',
    superNextIcon = '\u00BB',
    // Limitation
    minDate,
    maxDate,
    generateConfig,
    locale,
    pickerValue,
    panelType: type
  } = (0, _context.usePanelContext)();
  const headerPrefixCls = `${prefixCls}-header`;
  const {
    hidePrev,
    hideNext,
    hideHeader
  } = React.useContext(_context.PickerHackContext);

  // ======================= Limitation =======================
  const disabledOffsetPrev = React.useMemo(() => {
    if (!minDate || !offset || !getEnd) {
      return false;
    }
    const prevPanelLimitDate = getEnd(offset(-1, pickerValue));
    return !(0, _dateUtil.isSameOrAfter)(generateConfig, locale, prevPanelLimitDate, minDate, type);
  }, [minDate, offset, pickerValue, getEnd, generateConfig, locale, type]);
  const disabledSuperOffsetPrev = React.useMemo(() => {
    if (!minDate || !superOffset || !getEnd) {
      return false;
    }
    const prevPanelLimitDate = getEnd(superOffset(-1, pickerValue));
    return !(0, _dateUtil.isSameOrAfter)(generateConfig, locale, prevPanelLimitDate, minDate, type);
  }, [minDate, superOffset, pickerValue, getEnd, generateConfig, locale, type]);
  const disabledOffsetNext = React.useMemo(() => {
    if (!maxDate || !offset || !getStart) {
      return false;
    }
    const nextPanelLimitDate = getStart(offset(1, pickerValue));
    return !(0, _dateUtil.isSameOrAfter)(generateConfig, locale, maxDate, nextPanelLimitDate, type);
  }, [maxDate, offset, pickerValue, getStart, generateConfig, locale, type]);
  const disabledSuperOffsetNext = React.useMemo(() => {
    if (!maxDate || !superOffset || !getStart) {
      return false;
    }
    const nextPanelLimitDate = getStart(superOffset(1, pickerValue));
    return !(0, _dateUtil.isSameOrAfter)(generateConfig, locale, maxDate, nextPanelLimitDate, type);
  }, [maxDate, superOffset, pickerValue, getStart, generateConfig, locale, type]);

  // ========================= Offset =========================
  const onOffset = distance => {
    if (offset) {
      onChange(offset(distance, pickerValue));
    }
  };
  const onSuperOffset = distance => {
    if (superOffset) {
      onChange(superOffset(distance, pickerValue));
    }
  };

  // ========================= Render =========================
  if (hideHeader) {
    return null;
  }
  const prevBtnCls = `${headerPrefixCls}-prev-btn`;
  const nextBtnCls = `${headerPrefixCls}-next-btn`;
  const superPrevBtnCls = `${headerPrefixCls}-super-prev-btn`;
  const superNextBtnCls = `${headerPrefixCls}-super-next-btn`;
  return /*#__PURE__*/React.createElement("div", {
    className: (0, _clsx.clsx)(headerPrefixCls, classNames.header),
    style: styles.header
  }, superOffset && /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": locale.previousYear,
    onClick: () => onSuperOffset(-1),
    tabIndex: -1,
    className: (0, _clsx.clsx)(superPrevBtnCls, disabledSuperOffsetPrev && `${superPrevBtnCls}-disabled`),
    disabled: disabledSuperOffsetPrev,
    style: hidePrev ? HIDDEN_STYLE : {}
  }, superPrevIcon), offset && /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": locale.previousMonth,
    onClick: () => onOffset(-1),
    tabIndex: -1,
    className: (0, _clsx.clsx)(prevBtnCls, disabledOffsetPrev && `${prevBtnCls}-disabled`),
    disabled: disabledOffsetPrev,
    style: hidePrev ? HIDDEN_STYLE : {}
  }, prevIcon), /*#__PURE__*/React.createElement("div", {
    className: `${headerPrefixCls}-view`
  }, children), offset && /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": locale.nextMonth,
    onClick: () => onOffset(1),
    tabIndex: -1,
    className: (0, _clsx.clsx)(nextBtnCls, disabledOffsetNext && `${nextBtnCls}-disabled`),
    disabled: disabledOffsetNext,
    style: hideNext ? HIDDEN_STYLE : {}
  }, nextIcon), superOffset && /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": locale.nextYear,
    onClick: () => onSuperOffset(1),
    tabIndex: -1,
    className: (0, _clsx.clsx)(superNextBtnCls, disabledSuperOffsetNext && `${superNextBtnCls}-disabled`),
    disabled: disabledSuperOffsetNext,
    style: hideNext ? HIDDEN_STYLE : {}
  }, superNextIcon));
}
var _default = exports.default = PanelHeader;