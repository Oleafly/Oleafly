import { clsx } from 'clsx';
import * as React from 'react';
import { formatValue } from "../../utils/dateUtil";
import { PanelContext, useInfo } from "../context";
import PanelHeader from "../PanelHeader";
import TimePanelBody from "./TimePanelBody";
export default function TimePanel(props) {
  const {
    prefixCls,
    value,
    locale,
    generateConfig,
    // Format
    showTime
  } = props;
  const {
    format
  } = showTime || {};
  const panelPrefixCls = `${prefixCls}-time-panel`;

  // ========================== Base ==========================
  const [info] = useInfo(props, 'time');

  // ========================= Render =========================
  return /*#__PURE__*/React.createElement(PanelContext.Provider, {
    value: info
  }, /*#__PURE__*/React.createElement("div", {
    className: clsx(panelPrefixCls)
  }, /*#__PURE__*/React.createElement(PanelHeader, null, value ? formatValue(value, {
    locale,
    format,
    generateConfig
  }) : '\u00A0'), /*#__PURE__*/React.createElement(TimePanelBody, showTime)));
}