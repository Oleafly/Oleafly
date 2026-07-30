import { warning } from '@rc-component/util';
import * as React from 'react';
import { findValidateTime } from "../PickerPanel/TimePanel/TimePanelBody/util";
import { leftPad } from "../utils/miscUtil";
function emptyDisabled() {
  return [];
}
function generateUnits(start, end, step = 1, hideDisabledOptions = false, disabledUnits = [], pad = 2) {
  const units = [];
  const integerStep = step >= 1 ? step | 0 : 1;
  for (let i = start; i <= end; i += integerStep) {
    const disabled = disabledUnits.includes(i);
    if (!disabled || !hideDisabledOptions) {
      units.push({
        label: leftPad(i, pad),
        value: i,
        disabled
      });
    }
  }
  return units;
}

/**
 * Parse time props to get util info
 */
export default function useTimeInfo(generateConfig, props = {}, date) {
  const {
    // Show
    use12Hours,
    // Steps
    hourStep = 1,
    minuteStep = 1,
    secondStep = 1,
    millisecondStep = 100,
    // Disabled
    hideDisabledOptions,
    disabledTime,
    disabledHours,
    disabledMinutes,
    disabledSeconds
  } = props || {};
  const mergedDate = React.useMemo(() => date || generateConfig.getNow(), [date, generateConfig]);

  // ======================== Warnings ========================
  if (process.env.NODE_ENV !== 'production') {
    const isHourStepValid = 24 % hourStep === 0;
    const isMinuteStepValid = 60 % minuteStep === 0;
    const isSecondStepValid = 60 % secondStep === 0;
    warning(isHourStepValid, `\`hourStep\` ${hourStep} is invalid. It should be a factor of 24.`);
    warning(isMinuteStepValid, `\`minuteStep\` ${minuteStep} is invalid. It should be a factor of 60.`);
    warning(isSecondStepValid, `\`secondStep\` ${secondStep} is invalid. It should be a factor of 60.`);
  }

  // ======================== Disabled ========================
  const getDisabledTimes = React.useCallback(targetDate => {
    const disabledConfig = disabledTime?.(targetDate) || {};
    return [disabledConfig.disabledHours || disabledHours || emptyDisabled, disabledConfig.disabledMinutes || disabledMinutes || emptyDisabled, disabledConfig.disabledSeconds || disabledSeconds || emptyDisabled, disabledConfig.disabledMilliseconds || emptyDisabled];
  }, [disabledTime, disabledHours, disabledMinutes, disabledSeconds]);
  const [mergedDisabledHours, mergedDisabledMinutes, mergedDisabledSeconds, mergedDisabledMilliseconds] = React.useMemo(() => getDisabledTimes(mergedDate), [mergedDate, getDisabledTimes]);

  // ========================= Column =========================
  const getAllUnits = React.useCallback((getDisabledHours, getDisabledMinutes, getDisabledSeconds, getDisabledMilliseconds) => {
    const hours = generateUnits(0, 23, hourStep, hideDisabledOptions, getDisabledHours());

    // Hours
    const rowHourUnits = use12Hours ? hours.map(unit => ({
      ...unit,
      label: leftPad(unit.value % 12 || 12, 2)
    })) : hours;

    // Minutes
    const getMinuteUnits = nextHour => generateUnits(0, 59, minuteStep, hideDisabledOptions, getDisabledMinutes(nextHour));

    // Seconds
    const getSecondUnits = (nextHour, nextMinute) => generateUnits(0, 59, secondStep, hideDisabledOptions, getDisabledSeconds(nextHour, nextMinute));

    // Milliseconds
    const getMillisecondUnits = (nextHour, nextMinute, nextSecond) => generateUnits(0, 999, millisecondStep, hideDisabledOptions, getDisabledMilliseconds(nextHour, nextMinute, nextSecond), 3);
    return [rowHourUnits, getMinuteUnits, getSecondUnits, getMillisecondUnits];
  }, [hideDisabledOptions, hourStep, use12Hours, millisecondStep, minuteStep, secondStep]);
  const [rowHourUnits, getMinuteUnits, getSecondUnits, getMillisecondUnits] = React.useMemo(() => getAllUnits(mergedDisabledHours, mergedDisabledMinutes, mergedDisabledSeconds, mergedDisabledMilliseconds), [getAllUnits, mergedDisabledHours, mergedDisabledMinutes, mergedDisabledSeconds, mergedDisabledMilliseconds]);

  // ======================== Validate ========================
  /**
   * Get validate time with `disabledTime`, `certainDate` to specific the date need to check
   */
  const getValidTime = (nextTime, certainDate) => {
    let getCheckHourUnits = () => rowHourUnits;
    let getCheckMinuteUnits = getMinuteUnits;
    let getCheckSecondUnits = getSecondUnits;
    let getCheckMillisecondUnits = getMillisecondUnits;
    if (certainDate) {
      const [targetDisabledHours, targetDisabledMinutes, targetDisabledSeconds, targetDisabledMilliseconds] = getDisabledTimes(certainDate);
      const [targetRowHourUnits, targetGetMinuteUnits, targetGetSecondUnits, targetGetMillisecondUnits] = getAllUnits(targetDisabledHours, targetDisabledMinutes, targetDisabledSeconds, targetDisabledMilliseconds);
      getCheckHourUnits = () => targetRowHourUnits;
      getCheckMinuteUnits = targetGetMinuteUnits;
      getCheckSecondUnits = targetGetSecondUnits;
      getCheckMillisecondUnits = targetGetMillisecondUnits;
    }
    const validateDate = findValidateTime(nextTime, getCheckHourUnits, getCheckMinuteUnits, getCheckSecondUnits, getCheckMillisecondUnits, generateConfig);
    return validateDate;
  };
  return [
  // getValidTime
  getValidTime,
  // Units
  rowHourUnits, getMinuteUnits, getSecondUnits, getMillisecondUnits];
}