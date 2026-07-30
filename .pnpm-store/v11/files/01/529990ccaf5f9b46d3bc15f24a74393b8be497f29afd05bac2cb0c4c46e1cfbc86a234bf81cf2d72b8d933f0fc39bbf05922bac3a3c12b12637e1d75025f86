function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
import * as React from 'react';
import { formatValue, isInRange, isSameYear } from "../../utils/dateUtil";
import { PanelContext, useInfo } from "../context";
import PanelBody from "../PanelBody";
import PanelHeader from "../PanelHeader";
export default function YearPanel(props) {
  const {
    prefixCls,
    locale,
    generateConfig,
    pickerValue,
    disabledDate,
    onPickerValueChange,
    onModeChange
  } = props;
  const panelPrefixCls = `${prefixCls}-year-panel`;

  // ========================== Base ==========================
  const [info] = useInfo(props, 'year');
  const getStartYear = date => {
    const startYear = Math.floor(generateConfig.getYear(date) / 10) * 10;
    return generateConfig.setYear(date, startYear);
  };
  const getEndYear = date => {
    const startYear = getStartYear(date);
    return generateConfig.addYear(startYear, 9);
  };
  const startYearDate = getStartYear(pickerValue);
  const endYearDate = getEndYear(pickerValue);
  const baseDate = generateConfig.addYear(startYearDate, -1);

  // ========================= Cells ==========================
  const getCellDate = (date, offset) => {
    return generateConfig.addYear(date, offset);
  };
  const getCellText = date => {
    return formatValue(date, {
      locale,
      format: locale.cellYearFormat,
      generateConfig
    });
  };
  const getCellClassName = date => {
    return {
      [`${prefixCls}-cell-in-view`]: isSameYear(generateConfig, date, startYearDate) || isSameYear(generateConfig, date, endYearDate) || isInRange(generateConfig, startYearDate, endYearDate, date)
    };
  };

  // ======================== Disabled ========================
  const mergedDisabledDate = disabledDate ? (currentDate, disabledInfo) => {
    // Start
    const startMonth = generateConfig.setMonth(currentDate, 0);
    const startDate = generateConfig.setDate(startMonth, 1);

    // End
    const endMonth = generateConfig.addYear(startDate, 1);
    const endDate = generateConfig.addDate(endMonth, -1);
    return disabledDate(startDate, disabledInfo) && disabledDate(endDate, disabledInfo);
  } : null;

  // ========================= Header =========================
  const yearNode = /*#__PURE__*/React.createElement("button", {
    type: "button",
    key: "decade",
    "aria-label": locale.decadeSelect,
    onClick: () => {
      onModeChange('decade');
    },
    tabIndex: -1,
    className: `${prefixCls}-decade-btn`
  }, formatValue(startYearDate, {
    locale,
    format: locale.yearFormat,
    generateConfig
  }), "-", formatValue(endYearDate, {
    locale,
    format: locale.yearFormat,
    generateConfig
  }));

  // ========================= Render =========================
  return /*#__PURE__*/React.createElement(PanelContext.Provider, {
    value: info
  }, /*#__PURE__*/React.createElement("div", {
    className: panelPrefixCls
  }, /*#__PURE__*/React.createElement(PanelHeader, {
    superOffset: distance => generateConfig.addYear(pickerValue, distance * 10),
    onChange: onPickerValueChange
    // Limitation
    ,
    getStart: getStartYear,
    getEnd: getEndYear
  }, yearNode), /*#__PURE__*/React.createElement(PanelBody, _extends({}, props, {
    disabledDate: mergedDisabledDate,
    titleFormat: locale.fieldYearFormat,
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