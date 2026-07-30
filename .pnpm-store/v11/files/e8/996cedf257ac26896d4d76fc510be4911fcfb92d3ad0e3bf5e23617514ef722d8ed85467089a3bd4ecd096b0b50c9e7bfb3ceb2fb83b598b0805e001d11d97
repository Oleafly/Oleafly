"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = WeekPanel;
var _clsx = require("clsx");
var React = _interopRequireWildcard(require("react"));
var _dateUtil = require("../../utils/dateUtil");
var _DatePanel = _interopRequireDefault(require("../DatePanel"));
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
function WeekPanel(props) {
  const {
    prefixCls,
    generateConfig,
    locale,
    value,
    hoverValue,
    hoverRangeValue
  } = props;

  // =============================== Row ================================
  const localeName = locale.locale;
  const rowPrefixCls = `${prefixCls}-week-panel-row`;
  const rowClassName = currentDate => {
    const rangeCls = {};
    if (hoverRangeValue) {
      const [rangeStart, rangeEnd] = hoverRangeValue;
      const isRangeStart = (0, _dateUtil.isSameWeek)(generateConfig, localeName, rangeStart, currentDate);
      const isRangeEnd = (0, _dateUtil.isSameWeek)(generateConfig, localeName, rangeEnd, currentDate);
      rangeCls[`${rowPrefixCls}-range-start`] = isRangeStart;
      rangeCls[`${rowPrefixCls}-range-end`] = isRangeEnd;
      rangeCls[`${rowPrefixCls}-range-hover`] = !isRangeStart && !isRangeEnd && (0, _dateUtil.isInRange)(generateConfig, rangeStart, rangeEnd, currentDate);
    }
    if (hoverValue) {
      rangeCls[`${rowPrefixCls}-hover`] = hoverValue.some(date => (0, _dateUtil.isSameWeek)(generateConfig, localeName, currentDate, date));
    }
    return (0, _clsx.clsx)(rowPrefixCls, {
      [`${rowPrefixCls}-selected`]: !hoverRangeValue && (0, _dateUtil.isSameWeek)(generateConfig, localeName, value, currentDate)
    },
    // Patch for hover range
    rangeCls);
  };

  // ============================== Render ==============================
  return /*#__PURE__*/React.createElement(_DatePanel.default, _extends({}, props, {
    mode: "week",
    panelName: "week",
    rowClassName: rowClassName
  }));
}