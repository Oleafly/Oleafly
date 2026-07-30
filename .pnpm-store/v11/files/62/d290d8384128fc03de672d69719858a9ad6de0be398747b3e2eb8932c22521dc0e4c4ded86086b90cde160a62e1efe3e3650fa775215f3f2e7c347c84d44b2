function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
import * as React from 'react';
import { formatValue } from "../../utils/dateUtil";
import { PanelContext, useInfo } from "../context";
import PanelBody from "../PanelBody";
import PanelHeader from "../PanelHeader";
export default function MonthPanel(props) {
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
  const [info] = useInfo(props, 'month');
  const baseDate = generateConfig.setMonth(pickerValue, 0);

  // ========================= Month ==========================
  const monthsLocale = locale.shortMonths || (generateConfig.locale.getShortMonths ? generateConfig.locale.getShortMonths(locale.locale) : []);

  // ========================= Cells ==========================
  const getCellDate = (date, offset) => {
    return generateConfig.addMonth(date, offset);
  };
  const getCellText = date => {
    const month = generateConfig.getMonth(date);
    return locale.monthFormat ? formatValue(date, {
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
  }, formatValue(pickerValue, {
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
    superOffset: distance => generateConfig.addYear(pickerValue, distance),
    onChange: onPickerValueChange
    // Limitation
    ,
    getStart: date => generateConfig.setMonth(date, 0),
    getEnd: date => generateConfig.setMonth(date, 11)
  }, yearNode), /*#__PURE__*/React.createElement(PanelBody, _extends({}, props, {
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