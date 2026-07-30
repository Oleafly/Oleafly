"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useFilledProps;
var _util = require("@rc-component/util");
var React = _interopRequireWildcard(require("react"));
var _useLocale = _interopRequireDefault(require("../../hooks/useLocale"));
var _useTimeConfig = require("../../hooks/useTimeConfig");
var _miscUtil = require("../../utils/miscUtil");
var _useClearIcon = require("../Selector/hooks/useClearIcon");
var _useDisabledBoundary = _interopRequireDefault(require("./useDisabledBoundary"));
var _useFieldFormat = require("./useFieldFormat");
var _useInputReadOnly = _interopRequireDefault(require("./useInputReadOnly"));
var _useInvalidate = _interopRequireDefault(require("./useInvalidate"));
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function useList(value, fillMode = false) {
  const values = React.useMemo(() => {
    const list = value ? (0, _miscUtil.toArray)(value) : value;
    if (fillMode && list) {
      list[1] = list[1] || list[0];
    }
    return list;
  }, [value, fillMode]);
  return values;
}

/**
 * Align the outer props with unique typed and fill undefined props.
 * This is shared with both RangePicker and Picker. This will do:
 * - Convert `value` & `defaultValue` to array
 * - handle the legacy props fill like `clearIcon` + `allowClear` = `clearIcon`
 */
function useFilledProps(props, updater) {
  const {
    generateConfig,
    locale,
    picker = 'date',
    prefixCls = 'rc-picker',
    previewValue = 'hover',
    styles = {},
    classNames = {},
    order = true,
    components = {},
    inputRender,
    allowClear,
    clearIcon,
    needConfirm,
    multiple,
    format,
    inputReadOnly,
    disabledDate,
    minDate,
    maxDate,
    showTime,
    value,
    defaultValue,
    pickerValue,
    defaultPickerValue
  } = props;
  const values = useList(value);
  const defaultValues = useList(defaultValue);
  const pickerValues = useList(pickerValue);
  const defaultPickerValues = useList(defaultPickerValue);

  // ======================== Picker ========================
  /** Almost same as `picker`, but add `datetime` for `date` with `showTime` */
  const internalPicker = picker === 'date' && showTime ? 'datetime' : picker;

  /** The picker is `datetime` or `time` */
  const multipleInteractivePicker = internalPicker === 'time' || internalPicker === 'datetime';
  const complexPicker = multipleInteractivePicker || multiple;
  const mergedNeedConfirm = needConfirm ?? multipleInteractivePicker;

  // ========================== Time ==========================
  // Auto `format` need to check `showTime.showXXX` first.
  // And then merge the `locale` into `mergedShowTime`.
  const [timeProps, localeTimeProps, showTimeFormat, propFormat] = (0, _useTimeConfig.getTimeProps)(props);

  // ======================= Locales ========================
  const mergedLocale = (0, _useLocale.default)(locale, localeTimeProps);
  const mergedShowTime = React.useMemo(() => (0, _useTimeConfig.fillShowTimeConfig)(internalPicker, showTimeFormat, propFormat, timeProps, mergedLocale), [internalPicker, showTimeFormat, propFormat, timeProps, mergedLocale]);

  // ======================= Warning ========================
  if (process.env.NODE_ENV !== 'production' && picker === 'time') {
    if (['disabledHours', 'disabledMinutes', 'disabledSeconds'].some(key => props[key])) {
      (0, _util.warning)(false, `'disabledHours', 'disabledMinutes', 'disabledSeconds' will be removed in the next major version, please use 'disabledTime' instead.`);
    }
  }

  // ======================== Props =========================
  const filledProps = React.useMemo(() => ({
    ...props,
    previewValue,
    prefixCls,
    locale: mergedLocale,
    picker,
    styles,
    classNames,
    order,
    components: {
      input: inputRender,
      ...components
    },
    clearIcon: (0, _useClearIcon.fillClearIcon)(prefixCls, allowClear, clearIcon),
    showTime: mergedShowTime,
    value: values,
    defaultValue: defaultValues,
    pickerValue: pickerValues,
    defaultPickerValue: defaultPickerValues,
    ...updater?.()
  }), [props]);

  // ======================== Format ========================
  const [formatList, maskFormat] = (0, _useFieldFormat.useFieldFormat)(internalPicker, mergedLocale, format);

  // ======================= ReadOnly =======================
  const mergedInputReadOnly = (0, _useInputReadOnly.default)(formatList, inputReadOnly, multiple);

  // ======================= Boundary =======================
  const disabledBoundaryDate = (0, _useDisabledBoundary.default)(generateConfig, locale, disabledDate, minDate, maxDate);

  // ====================== Invalidate ======================
  const isInvalidateDate = (0, _useInvalidate.default)(generateConfig, picker, disabledBoundaryDate, mergedShowTime);

  // ======================== Merged ========================
  const mergedProps = React.useMemo(() => ({
    ...filledProps,
    needConfirm: mergedNeedConfirm,
    inputReadOnly: mergedInputReadOnly,
    disabledDate: disabledBoundaryDate
  }), [filledProps, mergedNeedConfirm, mergedInputReadOnly, disabledBoundaryDate]);
  return [mergedProps, internalPicker, complexPicker, formatList, maskFormat, isInvalidateDate];
}