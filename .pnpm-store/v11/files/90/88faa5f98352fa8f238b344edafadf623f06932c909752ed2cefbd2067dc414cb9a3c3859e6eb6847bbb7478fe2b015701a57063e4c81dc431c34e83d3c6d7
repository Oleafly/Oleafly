function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
import { clsx } from 'clsx';
import * as React from 'react';
import { formatValue, getWeekStartDate, isSameDate, isSameMonth, WEEK_DAY_COUNT } from "../../utils/dateUtil";
import { PanelContext, useInfo } from "../context";
import PanelBody from "../PanelBody";
import PanelHeader from "../PanelHeader";
export default function DatePanel(props) {
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
  const [info, now] = useInfo(props, mode);
  const weekFirstDay = generateConfig.locale.getWeekFirstDay(locale.locale);
  const monthStartDate = generateConfig.setDate(pickerValue, 1);
  const baseDate = getWeekStartDate(locale.locale, generateConfig, monthStartDate);
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
      className: clsx(cellPrefixCls, `${cellPrefixCls}-week`, {
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
  for (let i = 0; i < WEEK_DAY_COUNT; i += 1) {
    headerCells.push( /*#__PURE__*/React.createElement("th", {
      key: i
    }, weekDaysLocale[(i + weekFirstDay) % WEEK_DAY_COUNT]));
  }

  // >>> Body Cells
  const getCellDate = (date, offset) => {
    return generateConfig.addDate(date, offset);
  };
  const getCellText = date => {
    return formatValue(date, {
      locale,
      format: locale.cellDateFormat,
      generateConfig
    });
  };
  const getCellClassName = date => {
    const classObj = {
      [`${prefixCls}-cell-in-view`]: isSameMonth(generateConfig, date, pickerValue),
      [`${prefixCls}-cell-today`]: isSameDate(generateConfig, date, now)
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
  }, formatValue(pickerValue, {
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
  }, locale.monthFormat ? formatValue(pickerValue, {
    locale,
    format: locale.monthFormat,
    generateConfig
  }) : monthsLocale[month]);
  const monthYearNodes = locale.monthBeforeYear ? [monthNode, yearNode] : [yearNode, monthNode];

  // ========================= Render =========================
  return /*#__PURE__*/React.createElement(PanelContext.Provider, {
    value: info
  }, /*#__PURE__*/React.createElement("div", {
    className: clsx(panelPrefixCls, showWeek && `${panelPrefixCls}-show-week`)
  }, /*#__PURE__*/React.createElement(PanelHeader, {
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
  }, monthYearNodes), /*#__PURE__*/React.createElement(PanelBody, _extends({
    titleFormat: locale.fieldDateFormat
  }, props, {
    colNum: WEEK_DAY_COUNT,
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