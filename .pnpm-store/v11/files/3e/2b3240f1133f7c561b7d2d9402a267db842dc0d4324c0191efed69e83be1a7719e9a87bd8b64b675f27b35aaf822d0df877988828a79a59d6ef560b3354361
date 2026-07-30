function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
import * as React from 'react';
import { formatValue } from "../../utils/dateUtil";
import { PanelContext, useInfo } from "../context";
import PanelBody from "../PanelBody";
import PanelHeader from "../PanelHeader";
export default function QuarterPanel(props) {
  const {
    prefixCls,
    locale,
    generateConfig,
    pickerValue,
    onPickerValueChange,
    onModeChange
  } = props;
  const panelPrefixCls = `${prefixCls}-quarter-panel`;

  // ========================== Base ==========================
  const [info] = useInfo(props, 'quarter');
  const baseDate = generateConfig.setMonth(pickerValue, 0);

  // ========================= Cells ==========================
  const getCellDate = (date, offset) => {
    return generateConfig.addMonth(date, offset * 3);
  };
  const getCellText = date => {
    return formatValue(date, {
      locale,
      format: locale.cellQuarterFormat,
      generateConfig
    });
  };
  const getCellClassName = () => ({
    [`${prefixCls}-cell-in-view`]: true
  });

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
    titleFormat: locale.fieldQuarterFormat,
    colNum: 4,
    rowNum: 1,
    baseDate: baseDate
    // Body
    ,
    getCellDate: getCellDate,
    getCellText: getCellText,
    getCellClassName: getCellClassName
  }))));
}