"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useToggleDates;
var _dateUtil = require("../utils/dateUtil");
/**
 * Toggles the presence of a value in an array.
 * If the value exists in the array, removed it.
 * Else add it.
 */
function useToggleDates(generateConfig, locale, panelMode) {
  function toggleDates(list, target) {
    const index = list.findIndex(date => (0, _dateUtil.isSame)(generateConfig, locale, date, target, panelMode));
    if (index === -1) {
      return [...list, target];
    }
    const sliceList = [...list];
    sliceList.splice(index, 1);
    return sliceList;
  }
  return toggleDates;
}