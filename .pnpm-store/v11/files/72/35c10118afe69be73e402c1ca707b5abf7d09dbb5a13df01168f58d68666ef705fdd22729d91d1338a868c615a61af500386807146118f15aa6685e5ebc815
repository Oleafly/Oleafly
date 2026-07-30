export function findValidateTime(date, getHourUnits, getMinuteUnits, getSecondUnits, getMillisecondUnits, generateConfig) {
  let nextDate = date;
  function alignValidate(getUnitValue, setUnitValue, units) {
    let nextValue = generateConfig[getUnitValue](nextDate);
    const nextUnit = units.find(unit => unit.value === nextValue);
    if (!nextUnit || nextUnit.disabled) {
      // Find most closest unit
      const validateUnits = units.filter(unit => !unit.disabled);
      const reverseEnabledUnits = [...validateUnits].reverse();
      const validateUnit = reverseEnabledUnits.find(unit => unit.value <= nextValue) || validateUnits[0];
      if (validateUnit) {
        nextValue = validateUnit.value;
        nextDate = generateConfig[setUnitValue](nextDate, nextValue);
      }
    }
    return nextValue;
  }

  // Find validate hour
  const nextHour = alignValidate('getHour', 'setHour', getHourUnits());

  // Find validate minute
  const nextMinute = alignValidate('getMinute', 'setMinute', getMinuteUnits(nextHour));

  // Find validate second
  const nextSecond = alignValidate('getSecond', 'setSecond', getSecondUnits(nextHour, nextMinute));

  // Find validate millisecond
  alignValidate('getMillisecond', 'setMillisecond', getMillisecondUnits(nextHour, nextMinute, nextSecond));
  return nextDate;
}