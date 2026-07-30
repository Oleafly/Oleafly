"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = MonthPanel;
var React = _interopRequireWildcard(require("react"));
var _dateUtil = require("../../utils/dateUtil");
var _context = require("../context");
var _PanelBody = _interopRequireDefault(require("../PanelBody"));
var _PanelHeader = _interopRequireDefault(require("../PanelHeader"));
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
function MonthPanel(props) {
  const {
    prefixCls,
    locale,
    generateConfig,
    pickerValue,
    disabledDate,
    onPickerValueChange,
    onModeChange
  } = props;
  const panelPrefixCls = `${prefixCls}-month-panel`;

  // ========================== Base ==========================
  const [info] = (0, _context.useInfo)(props, 'month');
  const baseDate = generateConfig.setMonth(pickerValue, 0);

  // ========================= Month ==========================
  const monthsLocale = locale.shortMonths || (generateConfig.locale.getShortMonths ? generateConfig.locale.getShortMonths(locale.locale) : []);

  // ========================= Cells ==========================
  const getCellDate = (date, offset) => {
    return generateConfig.addMonth(date, offset);
  };
  const getCellText = date => {
    const month = generateConfig.getMonth(date);
    return locale.monthFormat ? (0, _dateUtil.formatValue)(date, {
      locale,
      format: locale.monthFormat,
      generateConfig
    }) : monthsLocale[month];
  };
  const getCellClassName = () => ({
    [`${prefixCls}-cell-in-view`]: true
  });

  // ======================== Disabled ========================
  const mergedDisabledDate = disabledDate ? (currentDate, disabledInfo) => {
    const startDate = generateConfig.setDate(currentDate, 1);
    const nextMonthStartDate = generateConfig.setMonth(startDate, generateConfig.getMonth(startDate) + 1);
    const endDate = generateConfig.addDate(nextMonthStartDate, -1);
    return disabledDate(startDate, disabledInfo) && disabledDate(endDate, disabledInfo);
  } : null;

  // ========================= Header =========================
  const yearNode = /*#__PURE__*/React.createElement("button", {
    type: "button",
    key: "year",
    "aria-label": locale.yearSelect,
    onClick: () => {
      onModeChange('year');
    },
    tabIndex: -1,
    className: `${prefixCls}-year-btn`
  }, (0, _dateUtil.formatValue)(pickerValue, {
    locale,
    format: locale.yearFormat,
    generateConfig
  }));

  // ========================= Render =========================
  return /*#__PURE__*/React.createElement(_context.PanelContext.Provider, {
    value: info
  }, /*#__PURE__*/React.createElement("div", {
    className: panelPrefixCls
  }, /*#__PURE__*/React.createElement(_PanelHeader.default, {
    superOffset: distance => generateConfig.addYear(pickerValue, distance),
    onChange: onPickerValueChange
    // Limitation
    ,
    getStart: date => generateConfig.setMonth(date, 0),
    getEnd: date => generateConfig.setMonth(date, 11)
  }, yearNode), /*#__PURE__*/React.createElement(_PanelBody.default, _extends({}, props, {
    disabledDate: mergedDisabledDate,
    titleFormat: locale.fieldMonthFormat,
    colNum: 3,
    rowNum: 4,
    baseDate: baseDate
    // Body
    ,
    getCellDate: getCellDate,
    getCellText: getCellText,
    getCellClassName: getCellClassName
  }))));
}