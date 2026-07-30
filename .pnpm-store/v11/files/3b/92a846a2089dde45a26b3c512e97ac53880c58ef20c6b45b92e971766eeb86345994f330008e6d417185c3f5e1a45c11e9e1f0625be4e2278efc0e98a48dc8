"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.fillIndex = fillIndex;
exports.getFromDate = getFromDate;
exports.getRowFormat = getRowFormat;
exports.leftPad = leftPad;
exports.pickProps = pickProps;
exports.toArray = toArray;
function leftPad(str, length, fill = '0') {
  let current = String(str);
  while (current.length < length) {
    current = `${fill}${current}`;
  }
  return current;
}

/**
 * Convert `value` to array. Will provide `[]` if is null or undefined.
 */
function toArray(val) {
  if (val === null || val === undefined) {
    return [];
  }
  return Array.isArray(val) ? val : [val];
}
function fillIndex(ori, index, value) {
  const clone = [...ori];
  clone[index] = value;
  return clone;
}

/** Pick props from the key list. Will filter empty value */
function pickProps(props, keys) {
  const clone = {};
  const mergedKeys = keys || Object.keys(props);
  mergedKeys.forEach(key => {
    if (props[key] !== undefined) {
      clone[key] = props[key];
    }
  });
  return clone;
}
function getRowFormat(picker, locale, format) {
  if (format) {
    return format;
  }
  switch (picker) {
    // All from the `locale.fieldXXXFormat` first
    case 'time':
      return locale.fieldTimeFormat;
    case 'datetime':
      return locale.fieldDateTimeFormat;
    case 'month':
      return locale.fieldMonthFormat;
    case 'year':
      return locale.fieldYearFormat;
    case 'quarter':
      return locale.fieldQuarterFormat;
    case 'week':
      return locale.fieldWeekFormat;
    default:
      return locale.fieldDateFormat;
  }
}
function getFromDate(calendarValues, activeIndexList, activeIndex) {
  const mergedActiveIndex = activeIndex !== undefined ? activeIndex : activeIndexList[activeIndexList.length - 1];
  const firstValuedIndex = activeIndexList.find(index => calendarValues[index]);
  return mergedActiveIndex !== firstValuedIndex ? calendarValues[firstValuedIndex] : undefined;
}