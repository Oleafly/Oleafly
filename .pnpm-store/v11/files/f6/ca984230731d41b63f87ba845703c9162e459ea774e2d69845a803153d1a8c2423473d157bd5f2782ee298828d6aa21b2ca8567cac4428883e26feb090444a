function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
import { clsx } from 'clsx';
import * as React from 'react';
import { isInRange, isSameWeek } from "../../utils/dateUtil";
import DatePanel from "../DatePanel";
export default function WeekPanel(props) {
  const {
    prefixCls,
    generateConfig,
    locale,
    value,
    hoverValue,
    hoverRangeValue
  } = props;

  // =============================== Row ================================
  const localeName = locale.locale;
  const rowPrefixCls = `${prefixCls}-week-panel-row`;
  const rowClassName = currentDate => {
    const rangeCls = {};
    if (hoverRangeValue) {
      const [rangeStart, rangeEnd] = hoverRangeValue;
      const isRangeStart = isSameWeek(generateConfig, localeName, rangeStart, currentDate);
      const isRangeEnd = isSameWeek(generateConfig, localeName, rangeEnd, currentDate);
      rangeCls[`${rowPrefixCls}-range-start`] = isRangeStart;
      rangeCls[`${rowPrefixCls}-range-end`] = isRangeEnd;
      rangeCls[`${rowPrefixCls}-range-hover`] = !isRangeStart && !isRangeEnd && isInRange(generateConfig, rangeStart, rangeEnd, currentDate);
    }
    if (hoverValue) {
      rangeCls[`${rowPrefixCls}-hover`] = hoverValue.some(date => isSameWeek(generateConfig, localeName, currentDate, date));
    }
    return clsx(rowPrefixCls, {
      [`${rowPrefixCls}-selected`]: !hoverRangeValue && isSameWeek(generateConfig, localeName, value, currentDate)
    },
    // Patch for hover range
    rangeCls);
  };

  // ============================== Render ==============================
  return /*#__PURE__*/React.createElement(DatePanel, _extends({}, props, {
    mode: "week",
    panelName: "week",
    rowClassName: rowClassName
  }));
}