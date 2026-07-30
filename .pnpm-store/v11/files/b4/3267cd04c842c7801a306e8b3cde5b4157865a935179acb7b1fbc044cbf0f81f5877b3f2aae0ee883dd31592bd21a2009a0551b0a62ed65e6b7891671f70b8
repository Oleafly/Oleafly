"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = DecadePanel;
var React = _interopRequireWildcard(require("react"));
var _dateUtil = require("../../utils/dateUtil");
var _context = require("../context");
var _PanelBody = _interopRequireDefault(require("../PanelBody"));
var _PanelHeader = _interopRequireDefault(require("../PanelHeader"));
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
function DecadePanel(props) {
  const {
    prefixCls,
    locale,
    generateConfig,
    pickerValue,
    disabledDate,
    onPickerValueChange
  } = props;
  const panelPrefixCls = `${prefixCls}-decade-panel`;

  // ========================== Base ==========================
  const [info] = (0, _context.useInfo)(props, 'decade');
  const getStartYear = date => {
    const startYear = Math.floor(generateConfig.getYear(date) / 100) * 100;
    return generateConfig.setYear(date, startYear);
  };
  const getEndYear = date => {
    const startYear = getStartYear(date);
    return generateConfig.addYear(startYear, 99);
  };
  const startYearDate = getStartYear(pickerValue);
  const endYearDate = getEndYear(pickerValue);
  const baseDate = generateConfig.addYear(startYearDate, -10);

  // ========================= Cells ==========================
  const getCellDate = (date, offset) => {
    return generateConfig.addYear(date, offset * 10);
  };
  const getCellText = date => {
    const cellYearFormat = locale.cellYearFormat;
    const startYearStr = (0, _dateUtil.formatValue)(date, {
      locale,
      format: cellYearFormat,
      generateConfig
    });
    const endYearStr = (0, _dateUtil.formatValue)(generateConfig.addYear(date, 9), {
      locale,
      format: cellYearFormat,
      generateConfig
    });
    return `${startYearStr}-${endYearStr}`;
  };
  const getCellClassName = date => {
    return {
      [`${prefixCls}-cell-in-view`]: (0, _dateUtil.isSameDecade)(generateConfig, date, startYearDate) || (0, _dateUtil.isSameDecade)(generateConfig, date, endYearDate) || (0, _dateUtil.isInRange)(generateConfig, startYearDate, endYearDate, date)
    };
  };

  // ======================== Disabled ========================
  const mergedDisabledDate = disabledDate ? (currentDate, disabledInfo) => {
    // Start
    const baseStartDate = generateConfig.setDate(currentDate, 1);
    const baseStartMonth = generateConfig.setMonth(baseStartDate, 0);
    const baseStartYear = generateConfig.setYear(baseStartMonth, Math.floor(generateConfig.getYear(baseStartMonth) / 10) * 10);

    // End
    const baseEndYear = generateConfig.addYear(baseStartYear, 10);
    const baseEndDate = generateConfig.addDate(baseEndYear, -1);
    return disabledDate(baseStartYear, disabledInfo) && disabledDate(baseEndDate, disabledInfo);
  } : null;

  // ========================= Header =========================
  const yearNode = `${(0, _dateUtil.formatValue)(startYearDate, {
    locale,
    format: locale.yearFormat,
    generateConfig
  })}-${(0, _dateUtil.formatValue)(endYearDate, {
    locale,
    format: locale.yearFormat,
    generateConfig
  })}`;

  // ========================= Render =========================
  return /*#__PURE__*/React.createElement(_context.PanelContext.Provider, {
    value: info
  }, /*#__PURE__*/React.createElement("div", {
    className: panelPrefixCls
  }, /*#__PURE__*/React.createElement(_PanelHeader.default, {
    superOffset: distance => generateConfig.addYear(pickerValue, distance * 100),
    onChange: onPickerValueChange
    // Limitation
    ,
    getStart: getStartYear,
    getEnd: getEndYear
  }, yearNode), /*#__PURE__*/React.createElement(_PanelBody.default, _extends({}, props, {
    disabledDate: mergedDisabledDate,
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