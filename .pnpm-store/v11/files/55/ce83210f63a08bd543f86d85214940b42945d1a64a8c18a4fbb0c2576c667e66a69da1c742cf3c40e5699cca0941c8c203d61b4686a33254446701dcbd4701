"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useRangeDisabledDate;
var _dateUtil = require("../../utils/dateUtil");
var _miscUtil = require("../../utils/miscUtil");
/**
 * RangePicker need additional logic to handle the `disabled` case. e.g.
 * [disabled, enabled] should end date not before start date
 */
function useRangeDisabledDate(values, disabled, activeIndexList, generateConfig, locale, disabledDate) {
  const activeIndex = activeIndexList[activeIndexList.length - 1];
  const rangeDisabledDate = (date, info) => {
    const [start, end] = values;
    const mergedInfo = {
      ...info,
      from: (0, _miscUtil.getFromDate)(values, activeIndexList)
    };

    // ============================ Disabled ============================
    // Should not select days before the start date
    if (activeIndex === 1 && disabled[0] && start &&
    // Same date isOK
    !(0, _dateUtil.isSame)(generateConfig, locale, start, date, mergedInfo.type) &&
    // Before start date
    generateConfig.isAfter(start, date)) {
      return true;
    }

    // Should not select days after the end date
    if (activeIndex === 0 && disabled[1] && end &&
    // Same date isOK
    !(0, _dateUtil.isSame)(generateConfig, locale, end, date, mergedInfo.type) &&
    // After end date
    generateConfig.isAfter(date, end)) {
      return true;
    }

    // ============================= Origin =============================
    return disabledDate?.(date, mergedInfo);
  };
  return rangeDisabledDate;
}