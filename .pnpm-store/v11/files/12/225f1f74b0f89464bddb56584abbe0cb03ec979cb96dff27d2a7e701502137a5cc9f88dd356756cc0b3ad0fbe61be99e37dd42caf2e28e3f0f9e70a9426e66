"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useLocale;
exports.fillTimeFormat = fillTimeFormat;
var _react = _interopRequireDefault(require("react"));
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
function fillTimeFormat(showHour, showMinute, showSecond, showMillisecond, showMeridiem) {
  let timeFormat = '';

  // Base HH:mm:ss
  const cells = [];
  if (showHour) {
    cells.push(showMeridiem ? 'hh' : 'HH');
  }
  if (showMinute) {
    cells.push('mm');
  }
  if (showSecond) {
    cells.push('ss');
  }
  timeFormat = cells.join(':');

  // Millisecond
  if (showMillisecond) {
    timeFormat += '.SSS';
  }

  // Meridiem
  if (showMeridiem) {
    timeFormat += ' A';
  }
  return timeFormat;
}

/**
 * Used for `useFilledProps` since it already in the React.useMemo
 */
function fillLocale(locale, showHour, showMinute, showSecond, showMillisecond, use12Hours) {
  // Not fill `monthFormat` since `locale.shortMonths` handle this
  // Not fill `cellMeridiemFormat` since AM & PM by default
  const {
    // Input Field
    fieldDateTimeFormat,
    fieldDateFormat,
    fieldTimeFormat,
    fieldMonthFormat,
    fieldYearFormat,
    fieldWeekFormat,
    fieldQuarterFormat,
    // Header Format
    yearFormat,
    // monthFormat,

    // Cell format
    cellYearFormat,
    cellQuarterFormat,
    dayFormat,
    cellDateFormat

    // cellMeridiemFormat,
  } = locale;
  const timeFormat = fillTimeFormat(showHour, showMinute, showSecond, showMillisecond, use12Hours);
  return {
    ...locale,
    fieldDateTimeFormat: fieldDateTimeFormat || `YYYY-MM-DD ${timeFormat}`,
    fieldDateFormat: fieldDateFormat || 'YYYY-MM-DD',
    fieldTimeFormat: fieldTimeFormat || timeFormat,
    fieldMonthFormat: fieldMonthFormat || 'YYYY-MM',
    fieldYearFormat: fieldYearFormat || 'YYYY',
    fieldWeekFormat: fieldWeekFormat || 'gggg-wo',
    fieldQuarterFormat: fieldQuarterFormat || 'YYYY-[Q]Q',
    yearFormat: yearFormat || 'YYYY',
    cellYearFormat: cellYearFormat || 'YYYY',
    cellQuarterFormat: cellQuarterFormat || '[Q]Q',
    cellDateFormat: cellDateFormat || dayFormat || 'D'
  };
}

/**
 * Fill locale format as start up
 */
function useLocale(locale, showProps) {
  const {
    showHour,
    showMinute,
    showSecond,
    showMillisecond,
    use12Hours
  } = showProps;
  return _react.default.useMemo(() => fillLocale(locale, showHour, showMinute, showSecond, showMillisecond, use12Hours), [locale, showHour, showMinute, showSecond, showMillisecond, use12Hours]);
}