function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
import * as React from 'react';
import useTimeInfo from "../../hooks/useTimeInfo";
import { fillTime } from "../../utils/dateUtil";
import DatePanel from "../DatePanel";
import TimePanel from "../TimePanel";
export default function DateTimePanel(props) {
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
  const [getValidTime] = useTimeInfo(generateConfig, showTime);

  // Merge the time info from `value` or `pickerValue`
  const mergeTime = date => {
    if (value) {
      return fillTime(generateConfig, date, value);
    }
    return fillTime(generateConfig, date, pickerValue);
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
  }, /*#__PURE__*/React.createElement(DatePanel, _extends({}, props, {
    onSelect: onDateSelect,
    onHover: onDateHover
  })), /*#__PURE__*/React.createElement(TimePanel, props));
}