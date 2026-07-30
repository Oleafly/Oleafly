"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = DatePanel;
var _clsx = require("clsx");
var React = _interopRequireWildcard(require("react"));
var _dateUtil = require("../../utils/dateUtil");
var _context = require("../context");
var _PanelBody = _interopRequireDefault(require("../PanelBody"));
var _PanelHeader = _interopRequireDefault(require("../PanelHeader"));
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
function DatePanel(props) {
  const {
    prefixCls,
    panelName = 'date',
    locale,
    generateConfig,
    pickerValue,
    onPickerValueChange,
    onModeChange,
    mode = 'date',
    disabledDate,
    onSelect,
    onHover,
    showWeek
  } = props;
  const panelPrefixCls = `${prefixCls}-${panelName}-panel`;
  const cellPrefixCls = `${prefixCls}-cell`;
  const isWeek = mode === 'week';

  // ========================== Base ==========================
  const [info, now] = (0, _context.useInfo)(props, mode);
  const weekFirstDay = generateConfig.locale.getWeekFirstDay(locale.locale);
  const monthStartDate = generateConfig.setDate(pickerValue, 1);
  const baseDate = (0, _dateUtil.getWeekStartDate)(locale.locale, generateConfig, monthStartDate);
  const month = generateConfig.getMonth(pickerValue);

  // =========================== PrefixColumn ===========================
  const showPrefixColumn = showWeek === undefined ? isWeek : showWeek;
  const prefixColumn = showPrefixColumn ? date => {
    // >>> Additional check for disabled
    const disabled = disabledDate?.(date, {
      type: 'week'
    });
    return /*#__PURE__*/React.createElement("td", {
      key: "week",
      className: (0, _clsx.clsx)(cellPrefixCls, `${cellPrefixCls}-week`, {
        [`${cellPrefixCls}-disabled`]: disabled
      })
      // Operation: Same as code in PanelBody
      ,
      onClick: () => {
        if (!disabled) {
          onSelect(date);
        }
      },
      onMouseEnter: () => {
        if (!disabled) {
          onHover?.(date);
        }
      },
      onMouseLeave: () => {
        if (!disabled) {
          onHover?.(null);
        }
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: `${cellPrefixCls}-inner`
    }, generateConfig.locale.getWeek(locale.locale, date)));
  } : null;

  // ========================= Cells ==========================
  // >>> Header Cells
  const headerCells = [];
  const weekDaysLocale = locale.shortWeekDays || (generateConfig.locale.getShortWeekDays ? generateConfig.locale.getShortWeekDays(locale.locale) : []);
  if (prefixColumn) {
    headerCells.push( /*#__PURE__*/React.createElement("th", {
      key: "empty"
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 0,
        height: 0,
        position: 'absolute',
        overflow: 'hidden',
        opacity: 0
      }
    }, locale.week)));
  }
  for (let i = 0; i < _dateUtil.WEEK_DAY_COUNT; i += 1) {
    headerCells.push( /*#__PURE__*/React.createElement("th", {
      key: i
    }, weekDaysLocale[(i + weekFirstDay) % _dateUtil.WEEK_DAY_COUNT]));
  }

  // >>> Body Cells
  const getCellDate = (date, offset) => {
    return generateConfig.addDate(date, offset);
  };
  const getCellText = date => {
    return (0, _dateUtil.formatValue)(date, {
      locale,
      format: locale.cellDateFormat,
      generateConfig
    });
  };
  const getCellClassName = date => {
    const classObj = {
      [`${prefixCls}-cell-in-view`]: (0, _dateUtil.isSameMonth)(generateConfig, date, pickerValue),
      [`${prefixCls}-cell-today`]: (0, _dateUtil.isSameDate)(generateConfig, date, now)
    };
    return classObj;
  };

  // ========================= Header =========================
  const monthsLocale = locale.shortMonths || (generateConfig.locale.getShortMonths ? generateConfig.locale.getShortMonths(locale.locale) : []);
  const yearNode = /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": locale.yearSelect,
    key: "year",
    onClick: () => {
      onModeChange('year', pickerValue);
    },
    tabIndex: -1,
    className: `${prefixCls}-year-btn`
  }, (0, _dateUtil.formatValue)(pickerValue, {
    locale,
    format: locale.yearFormat,
    generateConfig
  }));
  const monthNode = /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": locale.monthSelect,
    key: "month",
    onClick: () => {
      onModeChange('month', pickerValue);
    },
    tabIndex: -1,
    className: `${prefixCls}-month-btn`
  }, locale.monthFormat ? (0, _dateUtil.formatValue)(pickerValue, {
    locale,
    format: locale.monthFormat,
    generateConfig
  }) : monthsLocale[month]);
  const monthYearNodes = locale.monthBeforeYear ? [monthNode, yearNode] : [yearNode, monthNode];

  // ========================= Render =========================
  return /*#__PURE__*/React.createElement(_context.PanelContext.Provider, {
    value: info
  }, /*#__PURE__*/React.createElement("div", {
    className: (0, _clsx.clsx)(panelPrefixCls, showWeek && `${panelPrefixCls}-show-week`)
  }, /*#__PURE__*/React.createElement(_PanelHeader.default, {
    offset: distance => generateConfig.addMonth(pickerValue, distance),
    superOffset: distance => generateConfig.addYear(pickerValue, distance),
    onChange: onPickerValueChange
    // Limitation
    ,
    getStart: date => generateConfig.setDate(date, 1),
    getEnd: date => {
      let clone = generateConfig.setDate(date, 1);
      clone = generateConfig.addMonth(clone, 1);
      return generateConfig.addDate(clone, -1);
    }
  }, monthYearNodes), /*#__PURE__*/React.createElement(_PanelBody.default, _extends({
    titleFormat: locale.fieldDateFormat
  }, props, {
    colNum: _dateUtil.WEEK_DAY_COUNT,
    rowNum: 6,
    baseDate: baseDate
    // Header
    ,
    headerCells: headerCells
    // Body
    ,
    getCellDate: getCellDate,
    getCellText: getCellText,
    getCellClassName: getCellClassName,
    prefixColumn: prefixColumn,
    cellSelection: !isWeek
  }))));
}