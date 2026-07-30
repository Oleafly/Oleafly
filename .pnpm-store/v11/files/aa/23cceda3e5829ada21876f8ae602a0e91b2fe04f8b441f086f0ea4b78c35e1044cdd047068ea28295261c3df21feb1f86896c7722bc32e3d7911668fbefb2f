function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
import { clsx } from 'clsx';
import { useControlledState, useEvent, warning } from '@rc-component/util';
import * as React from 'react';
import useLocale from "../hooks/useLocale";
import { fillShowTimeConfig, getTimeProps } from "../hooks/useTimeConfig";
import useToggleDates from "../hooks/useToggleDates";
import PickerContext from "../PickerInput/context";
import useCellRender from "../PickerInput/hooks/useCellRender";
import { isSame } from "../utils/dateUtil";
import { pickProps, toArray } from "../utils/miscUtil";
import { PickerHackContext, SharedPanelContext } from "./context";
import DatePanel from "./DatePanel";
import DateTimePanel from "./DateTimePanel";
import DecadePanel from "./DecadePanel";
import MonthPanel from "./MonthPanel";
import QuarterPanel from "./QuarterPanel";
import TimePanel from "./TimePanel";
import WeekPanel from "./WeekPanel";
import YearPanel from "./YearPanel";
const DefaultComponents = {
  date: DatePanel,
  datetime: DateTimePanel,
  week: WeekPanel,
  month: MonthPanel,
  quarter: QuarterPanel,
  year: YearPanel,
  decade: DecadePanel,
  time: TimePanel
};
function PickerPanel(props, ref) {
  const {
    classNames: panelClassNames,
    styles: panelStyles,
    locale,
    generateConfig,
    direction,
    // Style
    prefixCls,
    tabIndex = 0,
    // Value
    multiple,
    defaultValue,
    value,
    onChange,
    onSelect,
    // Picker control
    defaultPickerValue,
    pickerValue,
    onPickerValueChange,
    // Mode
    mode,
    onPanelChange,
    picker = 'date',
    showTime,
    // Hover
    hoverValue,
    hoverRangeValue,
    // Cell
    cellRender,
    dateRender,
    monthCellRender,
    // Components
    components = {},
    hideHeader
  } = props;

  // ======================== Context ========================
  const {
    prefixCls: contextPrefixCls,
    classNames: pickerClassNames,
    styles: pickerStyles
  } = React.useContext(PickerContext) || {};

  // ======================== prefixCls ========================
  const mergedPrefixCls = contextPrefixCls || prefixCls || 'rc-picker';

  // ========================== Refs ==========================
  const rootRef = React.useRef();
  React.useImperativeHandle(ref, () => ({
    nativeElement: rootRef.current
  }));

  // ========================== Time ==========================
  // Auto `format` need to check `showTime.showXXX` first.
  // And then merge the `locale` into `mergedShowTime`.
  const [timeProps, localeTimeProps, showTimeFormat, propFormat] = getTimeProps(props);

  // ========================= Locale =========================
  const filledLocale = useLocale(locale, localeTimeProps);

  // ========================= Picker =========================
  const internalPicker = picker === 'date' && showTime ? 'datetime' : picker;

  // ======================== ShowTime ========================
  const mergedShowTime = React.useMemo(() => fillShowTimeConfig(internalPicker, showTimeFormat, propFormat, timeProps, filledLocale), [internalPicker, showTimeFormat, propFormat, timeProps, filledLocale]);

  // ========================== Now ===========================
  const now = generateConfig.getNow();

  // ========================== Mode ==========================
  const [mergedMode, setMergedMode] = useControlledState(picker || 'date', mode);
  const internalMode = mergedMode === 'date' && mergedShowTime ? 'datetime' : mergedMode;

  // ========================= Toggle =========================
  const toggleDates = useToggleDates(generateConfig, locale, internalPicker);

  // ========================= Value ==========================
  // >>> Real value
  // Interactive with `onChange` event which only trigger when the `mode` is `picker`
  const [innerValue, setMergedValue] = useControlledState(defaultValue, value);
  const mergedValue = React.useMemo(() => {
    // Clean up `[null]`
    const values = toArray(innerValue).filter(val => val);
    return multiple ? values : values.slice(0, 1);
  }, [innerValue, multiple]);

  // Sync value and only trigger onChange event when changed
  const triggerChange = useEvent(nextValue => {
    setMergedValue(nextValue);
    if (onChange && (nextValue === null || mergedValue.length !== nextValue.length || mergedValue.some((ori, index) => !isSame(generateConfig, locale, ori, nextValue[index], internalPicker)))) {
      onChange?.(multiple ? nextValue : nextValue[0]);
    }
  });

  // >>> CalendarValue
  // CalendarValue is a temp value for user operation
  // which will only trigger `onCalendarChange` but not `onChange`
  const onInternalSelect = useEvent(newDate => {
    onSelect?.(newDate);
    if (mergedMode === picker) {
      const nextValues = multiple ? toggleDates(mergedValue, newDate) : [newDate];
      triggerChange(nextValues);
    }
  });

  // >>> PickerValue
  // PickerValue is used to control the current displaying panel
  const [mergedPickerValue, setInternalPickerValue] = useControlledState(defaultPickerValue || mergedValue[0] || now, pickerValue);
  React.useEffect(() => {
    if (mergedValue[0] && !pickerValue) {
      setInternalPickerValue(mergedValue[0]);
    }
  }, [mergedValue[0]]);

  // Both trigger when manually pickerValue or mode change
  const triggerPanelChange = (viewDate, nextMode) => {
    onPanelChange?.(viewDate || pickerValue, nextMode || mergedMode);
  };
  const setPickerValue = (nextPickerValue, triggerPanelEvent = false) => {
    setInternalPickerValue(nextPickerValue);
    onPickerValueChange?.(nextPickerValue);
    if (triggerPanelEvent) {
      triggerPanelChange(nextPickerValue);
    }
  };
  const triggerModeChange = (nextMode, viewDate) => {
    setMergedMode(nextMode);
    if (viewDate) {
      setPickerValue(viewDate);
    }
    triggerPanelChange(viewDate, nextMode);
  };
  const onPanelValueSelect = nextValue => {
    onInternalSelect(nextValue);
    setPickerValue(nextValue);

    // Update mode if needed
    if (mergedMode !== picker) {
      const decadeYearQueue = ['decade', 'year'];
      const decadeYearMonthQueue = [...decadeYearQueue, 'month'];
      const pickerQueue = {
        quarter: [...decadeYearQueue, 'quarter'],
        week: [...decadeYearMonthQueue, 'week'],
        date: [...decadeYearMonthQueue, 'date']
      };
      const queue = pickerQueue[picker] || decadeYearMonthQueue;
      const index = queue.indexOf(mergedMode);
      const nextMode = queue[index + 1];
      if (nextMode) {
        triggerModeChange(nextMode, nextValue);
      }
    }
  };

  // ======================= Hover Date =======================
  const hoverRangeDate = React.useMemo(() => {
    let start;
    let end;
    if (Array.isArray(hoverRangeValue)) {
      [start, end] = hoverRangeValue;
    } else {
      start = hoverRangeValue;
    }

    // Return for not exist
    if (!start && !end) {
      return null;
    }

    // Fill if has empty
    start = start || end;
    end = end || start;
    return generateConfig.isAfter(start, end) ? [end, start] : [start, end];
  }, [hoverRangeValue, generateConfig]);

  // ======================= Components =======================
  // >>> cellRender
  const onInternalCellRender = useCellRender(cellRender, dateRender, monthCellRender);

  // ======================= Components =======================
  const PanelComponent = components[internalMode] || DefaultComponents[internalMode] || DatePanel;

  // ======================== Context =========================
  const sharedPanelContext = React.useMemo(() => ({
    classNames: pickerClassNames?.popup ?? panelClassNames ?? {},
    styles: pickerStyles?.popup ?? panelStyles ?? {}
  }), [pickerClassNames, panelClassNames, pickerStyles, panelStyles]);
  const parentHackContext = React.useContext(PickerHackContext);
  const pickerPanelContext = React.useMemo(() => ({
    ...parentHackContext,
    hideHeader
  }), [parentHackContext, hideHeader]);

  // ======================== Warnings ========================
  if (process.env.NODE_ENV !== 'production') {
    warning(!mergedValue || mergedValue.every(val => generateConfig.isValidate(val)), 'Invalidate date pass to `value` or `defaultValue`.');
  }

  // ========================= Render =========================
  const panelCls = `${mergedPrefixCls}-panel`;
  const panelProps = pickProps(props, [
  // Week
  'showWeek',
  // Icons
  'prevIcon', 'nextIcon', 'superPrevIcon', 'superNextIcon',
  // Disabled
  'disabledDate', 'minDate', 'maxDate',
  // Hover
  'onHover']);
  return /*#__PURE__*/React.createElement(SharedPanelContext.Provider, {
    value: sharedPanelContext
  }, /*#__PURE__*/React.createElement(PickerHackContext.Provider, {
    value: pickerPanelContext
  }, /*#__PURE__*/React.createElement("div", {
    ref: rootRef,
    tabIndex: tabIndex,
    className: clsx(panelCls, {
      [`${panelCls}-rtl`]: direction === 'rtl'
    })
  }, /*#__PURE__*/React.createElement(PanelComponent, _extends({}, panelProps, {
    // Time
    showTime: mergedShowTime
    // MISC
    ,
    prefixCls: mergedPrefixCls,
    locale: filledLocale,
    generateConfig: generateConfig
    // Mode
    ,
    onModeChange: triggerModeChange
    // Value
    ,
    pickerValue: mergedPickerValue,
    onPickerValueChange: nextPickerValue => {
      setPickerValue(nextPickerValue, true);
    },
    value: mergedValue[0],
    onSelect: onPanelValueSelect,
    values: mergedValue
    // Render
    ,
    cellRender: onInternalCellRender
    // Hover
    ,
    hoverRangeValue: hoverRangeDate,
    hoverValue: hoverValue
  })))));
}
const RefPanelPicker = /*#__PURE__*/React.memo( /*#__PURE__*/React.forwardRef(PickerPanel));
if (process.env.NODE_ENV !== 'production') {
  RefPanelPicker.displayName = 'PanelPicker';
}

// Make support generic
export default RefPanelPicker;