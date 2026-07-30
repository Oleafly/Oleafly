"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = DateTimePanel;
var React = _interopRequireWildcard(require("react"));
var _useTimeInfo = _interopRequireDefault(require("../../hooks/useTimeInfo"));
var _dateUtil = require("../../utils/dateUtil");
var _DatePanel = _interopRequireDefault(require("../DatePanel"));
var _TimePanel = _interopRequireDefault(require("../TimePanel"));
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
function DateTimePanel(props) {
  const {
    prefixCls,
    generateConfig,
    showTime,
    onSelect,
    value,
    pickerValue,
    onHover
  } = props;
  const panelPrefixCls = `${prefixCls}-datetime-panel`;

  // =============================== Time ===============================
  const [getValidTime] = (0, _useTimeInfo.default)(generateConfig, showTime);

  // Merge the time info from `value` or `pickerValue`
  const mergeTime = date => {
    if (value) {
      return (0, _dateUtil.fillTime)(generateConfig, date, value);
    }
    return (0, _dateUtil.fillTime)(generateConfig, date, pickerValue);
  };

  // ============================== Hover ===============================
  const onDateHover = date => {
    onHover?.(date ? mergeTime(date) : date);
  };

  // ============================== Select ==============================
  const onDateSelect = date => {
    // Merge with current time
    const cloneDate = mergeTime(date);
    onSelect(getValidTime(cloneDate, cloneDate));
  };

  // ============================== Render ==============================
  return /*#__PURE__*/React.createElement("div", {
    className: panelPrefixCls
  }, /*#__PURE__*/React.createElement(_DatePanel.default, _extends({}, props, {
    onSelect: onDateSelect,
    onHover: onDateHover
  })), /*#__PURE__*/React.createElement(_TimePanel.default, props));
}