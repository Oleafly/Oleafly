"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.fillShowTimeConfig = fillShowTimeConfig;
exports.getTimeProps = getTimeProps;
var _miscUtil = require("../utils/miscUtil");
var _useLocale = require("./useLocale");
function checkShow(format, keywords, show) {
  return show ?? keywords.some(keyword => format.includes(keyword));
}
const showTimeKeys = [
// 'format',
'showNow', 'showHour', 'showMinute', 'showSecond', 'showMillisecond', 'use12Hours', 'hourStep', 'minuteStep', 'secondStep', 'millisecondStep', 'hideDisabledOptions', 'defaultValue', 'disabledHours', 'disabledMinutes', 'disabledSeconds', 'disabledMilliseconds', 'disabledTime', 'changeOnScroll', 'defaultOpenValue'];

/**
 * Get SharedTimeProps from props.
 */
function pickTimeProps(props) {
  const timeProps = (0, _miscUtil.pickProps)(props, showTimeKeys);
  const {
    format,
    picker
  } = props;
  let propFormat = null;
  if (format) {
    propFormat = format;
    if (Array.isArray(propFormat)) {
      propFormat = propFormat[0];
    }
    propFormat = typeof propFormat === 'object' ? propFormat.format : propFormat;
  }
  if (picker === 'time') {
    timeProps.format = propFormat;
  }
  return [timeProps, propFormat];
}
function isStringFormat(format) {
  return format && typeof format === 'string';
}
/** Check if all the showXXX is `undefined` */
function existShowConfig(showHour, showMinute, showSecond, showMillisecond) {
  return [showHour, showMinute, showSecond, showMillisecond].some(show => show !== undefined);
}

/** Fill the showXXX if needed */
function fillShowConfig(hasShowConfig, showHour, showMinute, showSecond, showMillisecond) {
  let parsedShowHour = showHour;
  let parsedShowMinute = showMinute;
  let parsedShowSecond = showSecond;
  if (!hasShowConfig && !parsedShowHour && !parsedShowMinute && !parsedShowSecond && !showMillisecond) {
    parsedShowHour = true;
    parsedShowMinute = true;
    parsedShowSecond = true;
  } else if (hasShowConfig) {
    const existFalse = [parsedShowHour, parsedShowMinute, parsedShowSecond].some(show => show === false);
    const existTrue = [parsedShowHour, parsedShowMinute, parsedShowSecond].some(show => show === true);
    const defaultShow = existFalse ? true : !existTrue;
    parsedShowHour = parsedShowHour ?? defaultShow;
    parsedShowMinute = parsedShowMinute ?? defaultShow;
    parsedShowSecond = parsedShowSecond ?? defaultShow;
  }
  return [parsedShowHour, parsedShowMinute, parsedShowSecond, showMillisecond];
}

/**
 * Get `showHour`, `showMinute`, `showSecond` or other from the props.
 * This is pure function, will not get `showXXX` from the `format` prop.
 */
function getTimeProps(componentProps) {
  const {
    showTime
  } = componentProps;
  const [pickedProps, propFormat] = pickTimeProps(componentProps);
  const showTimeConfig = showTime && typeof showTime === 'object' ? showTime : {};
  const timeConfig = {
    defaultOpenValue: showTimeConfig.defaultOpenValue || showTimeConfig.defaultValue,
    ...pickedProps,
    ...showTimeConfig
  };
  const {
    showMillisecond
  } = timeConfig;
  let {
    showHour,
    showMinute,
    showSecond
  } = timeConfig;
  const hasShowConfig = existShowConfig(showHour, showMinute, showSecond, showMillisecond);
  [showHour, showMinute, showSecond] = fillShowConfig(hasShowConfig, showHour, showMinute, showSecond, showMillisecond);
  return [timeConfig, {
    ...timeConfig,
    showHour,
    showMinute,
    showSecond,
    showMillisecond
  }, timeConfig.format, propFormat];
}
function fillShowTimeConfig(picker, showTimeFormat, propFormat, timeConfig, locale) {
  const isTimePicker = picker === 'time';
  if (picker === 'datetime' || isTimePicker) {
    const pickedProps = timeConfig;

    // ====================== BaseFormat ======================
    const defaultLocaleFormat = (0, _miscUtil.getRowFormat)(picker, locale, null);
    let baselineFormat = defaultLocaleFormat;
    const formatList = [showTimeFormat, propFormat];
    for (let i = 0; i < formatList.length; i += 1) {
      const format = (0, _miscUtil.toArray)(formatList[i])[0];
      if (isStringFormat(format)) {
        baselineFormat = format;
        break;
      }
    }

    // ========================= Show =========================
    let {
      showHour,
      showMinute,
      showSecond,
      showMillisecond
    } = pickedProps;
    const {
      use12Hours
    } = pickedProps;
    const showMeridiem = checkShow(baselineFormat, ['a', 'A', 'LT', 'LLL', 'LTS'], use12Hours);
    const hasShowConfig = existShowConfig(showHour, showMinute, showSecond, showMillisecond);

    // Fill with format, if needed
    if (!hasShowConfig) {
      showHour = checkShow(baselineFormat, ['H', 'h', 'k', 'LT', 'LLL']);
      showMinute = checkShow(baselineFormat, ['m', 'LT', 'LLL']);
      showSecond = checkShow(baselineFormat, ['s', 'LTS']);
      showMillisecond = checkShow(baselineFormat, ['SSS']);
    }

    // Fallback if all can not see
    [showHour, showMinute, showSecond] = fillShowConfig(hasShowConfig, showHour, showMinute, showSecond, showMillisecond);

    // ======================== Format ========================
    const timeFormat = showTimeFormat || (0, _useLocale.fillTimeFormat)(showHour, showMinute, showSecond, showMillisecond, showMeridiem);

    // ======================== Props =========================
    return {
      ...pickedProps,
      // Format
      format: timeFormat,
      // Show Config
      showHour,
      showMinute,
      showSecond,
      showMillisecond,
      use12Hours: showMeridiem
    };
  }
  return null;
}