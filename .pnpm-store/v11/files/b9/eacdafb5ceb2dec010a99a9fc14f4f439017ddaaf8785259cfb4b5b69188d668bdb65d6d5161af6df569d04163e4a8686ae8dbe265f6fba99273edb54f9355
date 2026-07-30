"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _clsx = require("clsx");
var _util = require("@rc-component/util");
var React = _interopRequireWildcard(require("react"));
var _useLocale = _interopRequireDefault(require("../hooks/useLocale"));
var _useTimeConfig = require("../hooks/useTimeConfig");
var _useToggleDates = _interopRequireDefault(require("../hooks/useToggleDates"));
var _context = _interopRequireDefault(require("../PickerInput/context"));
var _useCellRender = _interopRequireDefault(require("../PickerInput/hooks/useCellRender"));
var _dateUtil = require("../utils/dateUtil");
var _miscUtil = require("../utils/miscUtil");
var _context2 = require("./context");
var _DatePanel = _interopRequireDefault(require("./DatePanel"));
var _DateTimePanel = _interopRequireDefault(require("./DateTimePanel"));
var _DecadePanel = _interopRequireDefault(require("./DecadePanel"));
var _MonthPanel = _interopRequireDefault(require("./MonthPanel"));
var _QuarterPanel = _interopRequireDefault(require("./QuarterPanel"));
var _TimePanel = _interopRequireDefault(require("./TimePanel"));
var _WeekPanel = _interopRequireDefault(require("./WeekPanel"));
var _YearPanel = _interopRequireDefault(require("./YearPanel"));
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
const DefaultComponents = {
  date: _DatePanel.default,
  datetime: _DateTimePanel.default,
  week: _WeekPanel.default,
  month: _MonthPanel.default,
  quarter: _QuarterPanel.default,
  year: _YearPanel.default,
  decade: _DecadePanel.default,
  time: _TimePanel.default
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
  } = React.useContext(_context.default) || {};

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
  const [timeProps, localeTimeProps, showTimeFormat, propFormat] = (0, _useTimeConfig.getTimeProps)(props);

  // ========================= Locale =========================
  const filledLocale = (0, _useLocale.default)(locale, localeTimeProps);

  // ========================= Picker =========================
  const internalPicker = picker === 'date' && showTime ? 'datetime' : picker;

  // ======================== ShowTime ========================
  const mergedShowTime = React.useMemo(() => (0, _useTimeConfig.fillShowTimeConfig)(internalPicker, showTimeFormat, propFormat, timeProps, filledLocale), [internalPicker, showTimeFormat, propFormat, timeProps, filledLocale]);

  // ========================== Now ===========================
  const now = generateConfig.getNow();

  // ========================== Mode ==========================
  const [mergedMode, setMergedMode] = (0, _util.useControlledState)(picker || 'date', mode);
  const internalMode = mergedMode === 'date' && mergedShowTime ? 'datetime' : mergedMode;

  // ========================= Toggle =========================
  const toggleDates = (0, _useToggleDates.default)(generateConfig, locale, internalPicker);

  // ========================= Value ==========================
  // >>> Real value
  // Interactive with `onChange` event which only trigger when the `mode` is `picker`
  const [innerValue, setMergedValue] = (0, _util.useControlledState)(defaultValue, value);
  const mergedValue = React.useMemo(() => {
    // Clean up `[null]`
    const values = (0, _miscUtil.toArray)(innerValue).filter(val => val);
    return multiple ? values : values.slice(0, 1);
  }, [innerValue, multiple]);

  // Sync value and only trigger onChange event when changed
  const triggerChange = (0, _util.useEvent)(nextValue => {
    setMergedValue(nextValue);
    if (onChange && (nextValue === null || mergedValue.length !== nextValue.length || mergedValue.some((ori, index) => !(0, _dateUtil.isSame)(generateConfig, locale, ori, nextValue[index], internalPicker)))) {
      onChange?.(multiple ? nextValue : nextValue[0]);
    }
  });

  // >>> CalendarValue
  // CalendarValue is a temp value for user operation
  // which will only trigger `onCalendarChange` but not `onChange`
  const onInternalSelect = (0, _util.useEvent)(newDate => {
    onSelect?.(newDate);
    if (mergedMode === picker) {
      const nextValues = multiple ? toggleDates(mergedValue, newDate) : [newDate];
      triggerChange(nextValues);
    }
  });

  // >>> PickerValue
  // PickerValue is used to control the current displaying panel
  const [mergedPickerValue, setInternalPickerValue] = (0, _util.useControlledState)(defaultPickerValue || mergedValue[0] || now, pickerValue);
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
  const onInternalCellRender = (0, _useCellRender.default)(cellRender, dateRender, monthCellRender);

  // ======================= Components =======================
  const PanelComponent = components[internalMode] || DefaultComponents[internalMode] || _DatePanel.default;

  // ======================== Context =========================
  const sharedPanelContext = React.useMemo(() => ({
    classNames: pickerClassNames?.popup ?? panelClassNames ?? {},
    styles: pickerStyles?.popup ?? panelStyles ?? {}
  }), [pickerClassNames, panelClassNames, pickerStyles, panelStyles]);
  const parentHackContext = React.useContext(_context2.PickerHackContext);
  const pickerPanelContext = React.useMemo(() => ({
    ...parentHackContext,
    hideHeader
  }), [parentHackContext, hideHeader]);

  // ======================== Warnings ========================
  if (process.env.NODE_ENV !== 'production') {
    (0, _util.warning)(!mergedValue || mergedValue.every(val => generateConfig.isValidate(val)), 'Invalidate date pass to `value` or `defaultValue`.');
  }

  // ========================= Render =========================
  const panelCls = `${mergedPrefixCls}-panel`;
  const panelProps = (0, _miscUtil.pickProps)(props, [
  // Week
  'showWeek',
  // Icons
  'prevIcon', 'nextIcon', 'superPrevIcon', 'superNextIcon',
  // Disabled
  'disabledDate', 'minDate', 'maxDate',
  // Hover
  'onHover']);
  return /*#__PURE__*/React.createElement(_context2.SharedPanelContext.Provider, {
    value: sharedPanelContext
  }, /*#__PURE__*/React.createElement(_context2.PickerHackContext.Provider, {
    value: pickerPanelContext
  }, /*#__PURE__*/React.createElement("div", {
    ref: rootRef,
    tabIndex: tabIndex,
    className: (0, _clsx.clsx)(panelCls, {
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
var _default = exports.default = RefPanelPicker;