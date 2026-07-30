"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _util = require("@rc-component/util");
var _clsx = require("clsx");
var React = _interopRequireWildcard(require("react"));
var _PickerTrigger = _interopRequireDefault(require("../PickerTrigger"));
var _util2 = require("../PickerTrigger/util");
var _miscUtil = require("../utils/miscUtil");
var _context = _interopRequireDefault(require("./context"));
var _useCellRender = _interopRequireDefault(require("./hooks/useCellRender"));
var _useFieldsInvalidate = _interopRequireDefault(require("./hooks/useFieldsInvalidate"));
var _useFilledProps = _interopRequireDefault(require("./hooks/useFilledProps"));
var _useOpen = _interopRequireDefault(require("./hooks/useOpen"));
var _usePickerRef = _interopRequireDefault(require("./hooks/usePickerRef"));
var _usePresets = _interopRequireDefault(require("./hooks/usePresets"));
var _useRangeActive = _interopRequireDefault(require("./hooks/useRangeActive"));
var _useRangeDisabledDate = _interopRequireDefault(require("./hooks/useRangeDisabledDate"));
var _useRangePickerValue = _interopRequireDefault(require("./hooks/useRangePickerValue"));
var _useRangeValue = _interopRequireWildcard(require("./hooks/useRangeValue"));
var _useShowNow = _interopRequireDefault(require("./hooks/useShowNow"));
var _Popup = _interopRequireDefault(require("./Popup"));
var _RangeSelector = _interopRequireDefault(require("./Selector/RangeSelector"));
var _useSemantic = _interopRequireDefault(require("../hooks/useSemantic"));
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
function separateConfig(config, defaultConfig) {
  const singleConfig = config ?? defaultConfig;
  if (Array.isArray(singleConfig)) {
    return singleConfig;
  }
  return [singleConfig, singleConfig];
}

/** Used for change event, it should always be not undefined */

function getActiveRange(activeIndex) {
  return activeIndex === 1 ? 'end' : 'start';
}
function RangePicker(props, ref) {
  // ========================= Prop =========================
  const [filledProps, internalPicker, complexPicker, formatList, maskFormat, isInvalidateDate] = (0, _useFilledProps.default)(props, () => {
    const {
      disabled,
      allowEmpty
    } = props;
    const mergedDisabled = separateConfig(disabled, false);
    const mergedAllowEmpty = separateConfig(allowEmpty, false);
    return {
      disabled: mergedDisabled,
      allowEmpty: mergedAllowEmpty
    };
  });
  const {
    // Style
    prefixCls,
    rootClassName,
    styles: propStyles,
    classNames: propClassNames,
    previewValue,
    // Value
    defaultValue,
    value,
    needConfirm,
    onClear,
    onKeyDown,
    // Disabled
    disabled,
    allowEmpty,
    disabledDate,
    minDate,
    maxDate,
    // Open
    defaultOpen,
    open,
    onOpenChange,
    // Picker
    locale,
    generateConfig,
    picker,
    showNow,
    showToday,
    showTime,
    // Mode
    mode,
    onPanelChange,
    onCalendarChange,
    onOk,
    // Picker Value
    defaultPickerValue,
    pickerValue,
    onPickerValueChange,
    // Format
    inputReadOnly,
    suffixIcon,
    // Focus
    onFocus,
    onBlur,
    // Presets
    presets,
    ranges,
    // Render
    components,
    cellRender,
    dateRender,
    monthCellRender,
    // Native
    onClick
  } = filledProps;

  // ========================= Refs =========================
  const selectorRef = (0, _usePickerRef.default)(ref);

  // ======================= Semantic =======================
  const [mergedClassNames, mergedStyles] = (0, _useSemantic.default)(propClassNames, propStyles);

  // ========================= Open =========================
  const [mergedOpen, setMergeOpen] = (0, _useOpen.default)(open, defaultOpen, disabled, onOpenChange);
  const triggerOpen = (nextOpen, config) => {
    // No need to open if all disabled
    if (disabled.some(fieldDisabled => !fieldDisabled) || !nextOpen) {
      setMergeOpen(nextOpen, config);
    }
  };

  // ======================== Values ========================
  const [mergedValue, setInnerValue, getCalendarValue, triggerCalendarChange, triggerOk] = (0, _useRangeValue.useInnerValue)(generateConfig, locale, formatList, true, false, defaultValue, value, onCalendarChange, onOk);
  const calendarValue = getCalendarValue();

  // ======================== Active ========================
  const [focused, triggerFocus, lastOperation, activeIndex, setActiveIndex, nextActiveIndex, activeIndexList, updateSubmitIndex, hasActiveSubmitValue] = (0, _useRangeActive.default)(disabled, allowEmpty, mergedOpen);
  const onSharedFocus = (event, index) => {
    triggerFocus(true);
    onFocus?.(event, {
      range: getActiveRange(index ?? activeIndex)
    });
  };
  const onSharedBlur = (event, index) => {
    triggerFocus(false);
    onBlur?.(event, {
      range: getActiveRange(index ?? activeIndex)
    });
  };

  // ======================= ShowTime =======================
  /** Used for Popup panel */
  const mergedShowTime = React.useMemo(() => {
    if (!showTime) {
      return null;
    }
    const {
      disabledTime
    } = showTime;
    const proxyDisabledTime = disabledTime ? date => {
      const range = getActiveRange(activeIndex);
      const fromDate = (0, _miscUtil.getFromDate)(calendarValue, activeIndexList, activeIndex);
      return disabledTime(date, range, {
        from: fromDate
      });
    } : undefined;
    return {
      ...showTime,
      disabledTime: proxyDisabledTime
    };
  }, [showTime, activeIndex, calendarValue, activeIndexList]);

  // ========================= Mode =========================
  const [modes, setModes] = (0, _util.useControlledState)([picker, picker], mode);
  const mergedMode = modes[activeIndex] || picker;

  /** Extends from `mergedMode` to patch `datetime` mode */
  const internalMode = mergedMode === 'date' && mergedShowTime ? 'datetime' : mergedMode;

  // ====================== PanelCount ======================
  const multiplePanel = internalMode === picker && internalMode !== 'time';

  // ======================= Show Now =======================
  const mergedShowNow = (0, _useShowNow.default)(picker, mergedMode, showNow, showToday, true);

  // ======================== Value =========================
  const [/** Trigger `onChange` by check `disabledDate` */
  flushSubmit, /** Trigger `onChange` directly without check `disabledDate` */
  triggerSubmitChange] = (0, _useRangeValue.default)(filledProps, mergedValue, setInnerValue, getCalendarValue, triggerCalendarChange, disabled, formatList, focused, mergedOpen, isInvalidateDate);

  // ===================== DisabledDate =====================
  const mergedDisabledDate = (0, _useRangeDisabledDate.default)(calendarValue, disabled, activeIndexList, generateConfig, locale, disabledDate);

  // ======================= Validate =======================
  const [submitInvalidates, onSelectorInvalid] = (0, _useFieldsInvalidate.default)(calendarValue, isInvalidateDate, allowEmpty);

  // ===================== Picker Value =====================
  const [currentPickerValue, setCurrentPickerValue] = (0, _useRangePickerValue.default)(generateConfig, locale, calendarValue, modes, mergedOpen, activeIndex, internalPicker, multiplePanel, defaultPickerValue, pickerValue, mergedShowTime?.defaultOpenValue, onPickerValueChange, minDate, maxDate);

  // >>> Mode need wait for `pickerValue`
  const triggerModeChange = (0, _util.useEvent)((nextPickerValue, nextMode, triggerEvent) => {
    const clone = (0, _miscUtil.fillIndex)(modes, activeIndex, nextMode);
    if (clone[0] !== modes[0] || clone[1] !== modes[1]) {
      setModes(clone);
    }

    // Compatible with `onPanelChange`
    if (onPanelChange && triggerEvent !== false) {
      const clonePickerValue = [...calendarValue];
      if (nextPickerValue) {
        clonePickerValue[activeIndex] = nextPickerValue;
      }
      onPanelChange(clonePickerValue, clone);
    }
  });

  // ======================== Change ========================
  const fillCalendarValue = (date, index) =>
  // Trigger change only when date changed
  (0, _miscUtil.fillIndex)(calendarValue, index, date);

  // ======================== Submit ========================
  /**
   * Trigger by confirm operation.
   * This function has already handle the `needConfirm` check logic.
   * - Selector: enter key
   * - Panel: OK button
   */
  const triggerPartConfirm = (date, skipFocus) => {
    let nextValue = calendarValue;
    if (date) {
      nextValue = fillCalendarValue(date, activeIndex);
    }
    updateSubmitIndex(activeIndex);
    // Get next focus index
    const nextIndex = nextActiveIndex(nextValue);

    // Change calendar value and tell flush it
    triggerCalendarChange(nextValue);
    flushSubmit(activeIndex, nextIndex === null);
    if (nextIndex === null) {
      triggerOpen(false, {
        force: true
      });
    } else if (!skipFocus) {
      selectorRef.current.focus({
        index: nextIndex
      });
    }
  };

  // ======================== Click =========================
  const onSelectorClick = event => {
    const rootNode = event.target.getRootNode();
    if (!selectorRef.current.nativeElement.contains(rootNode.activeElement ?? document.activeElement)) {
      // Click to focus the enabled input
      const enabledIndex = disabled.findIndex(d => !d);
      if (enabledIndex >= 0) {
        selectorRef.current.focus({
          index: enabledIndex
        });
      }
    }
    triggerOpen(true);
    onClick?.(event);
  };
  const onSelectorClear = () => {
    triggerSubmitChange(null);
    triggerOpen(false, {
      force: true
    });
    onClear?.();
  };

  // ======================== Hover =========================
  const [hoverSource, setHoverSource] = React.useState(null);
  const [internalHoverValues, setInternalHoverValues] = React.useState(null);
  const hoverValues = React.useMemo(() => {
    return internalHoverValues || calendarValue;
  }, [calendarValue, internalHoverValues]);

  // Clean up `internalHoverValues` when closed
  React.useEffect(() => {
    if (!mergedOpen) {
      setInternalHoverValues(null);
    }
  }, [mergedOpen]);

  // ========================================================
  // ==                       Panels                       ==
  // ========================================================
  // Save the offset with active bar position
  // const [activeOffset, setActiveOffset] = React.useState(0);
  const [activeInfo, setActiveInfo] = React.useState([0, 0, 0]);
  const onSetHover = (date, source) => {
    if (previewValue !== 'hover') {
      return;
    }
    setInternalHoverValues(date);
    setHoverSource(source);
  };

  // ======================= Presets ========================
  const presetList = (0, _usePresets.default)(presets, ranges);
  const onPresetHover = nextValues => {
    onSetHover(nextValues, 'preset');
  };
  const onPresetSubmit = nextValues => {
    const passed = triggerSubmitChange(nextValues);
    if (passed) {
      lastOperation('preset-click');
      triggerOpen(false, {
        force: true
      });
    }
  };
  const onNow = now => {
    triggerPartConfirm(now);
  };

  // ======================== Panel =========================
  const onPanelHover = date => {
    onSetHover(date ? fillCalendarValue(date, activeIndex) : null, 'cell');
  };

  // >>> Focus
  const onPanelFocus = event => {
    triggerOpen(true);
    onSharedFocus(event);
  };

  // >>> MouseDown
  const onPanelMouseDown = () => {
    lastOperation('panel');
  };

  // >>> Calendar
  const onPanelSelect = date => {
    const clone = (0, _miscUtil.fillIndex)(calendarValue, activeIndex, date);

    // Only trigger calendar event but not update internal `calendarValue` state
    triggerCalendarChange(clone);

    // >>> Trigger next active if !needConfirm
    // Fully logic check `useRangeValue` hook
    if (!needConfirm && !complexPicker && internalPicker === internalMode) {
      triggerPartConfirm(date);
    }
  };

  // >>> Close
  const onPopupClose = () => {
    // Close popup
    triggerOpen(false);
  };

  // >>> cellRender
  const onInternalCellRender = (0, _useCellRender.default)(cellRender, dateRender, monthCellRender, getActiveRange(activeIndex));

  // >>> Value
  const panelValue = calendarValue[activeIndex] || null;

  // >>> invalid
  const isPopupInvalidateDate = (0, _util.useEvent)(date => {
    return isInvalidateDate(date, {
      activeIndex
    });
  });
  const panelProps = React.useMemo(() => {
    const domProps = (0, _util.pickAttrs)(filledProps, false);
    const restProps = (0, _util.omit)(filledProps, [...Object.keys(domProps), 'onChange', 'onCalendarChange', 'onClear', 'style', 'className', 'onPanelChange', 'disabledTime', 'classNames', 'styles']);
    return restProps;
  }, [filledProps]);

  // >>> Render
  const panel = /*#__PURE__*/React.createElement(_Popup.default, _extends({}, panelProps, {
    showNow: mergedShowNow,
    showTime: mergedShowTime
    // Range
    ,
    range: true,
    multiplePanel: multiplePanel,
    activeInfo: activeInfo
    // Disabled
    ,
    disabledDate: mergedDisabledDate
    // Focus
    ,
    onFocus: onPanelFocus,
    onBlur: onSharedBlur,
    onPanelMouseDown: onPanelMouseDown
    // Mode
    ,
    picker: picker,
    mode: mergedMode,
    internalMode: internalMode,
    onPanelChange: triggerModeChange
    // Value
    ,
    format: maskFormat,
    value: panelValue,
    isInvalid: isPopupInvalidateDate,
    onChange: null,
    onSelect: onPanelSelect
    // PickerValue
    ,
    pickerValue: currentPickerValue,
    defaultOpenValue: (0, _miscUtil.toArray)(showTime?.defaultOpenValue)[activeIndex],
    onPickerValueChange: setCurrentPickerValue
    // Hover
    ,
    hoverValue: hoverValues,
    onHover: onPanelHover
    // Submit
    ,
    needConfirm: needConfirm,
    onSubmit: triggerPartConfirm,
    onOk: triggerOk
    // Preset
    ,
    presets: presetList,
    onPresetHover: onPresetHover,
    onPresetSubmit: onPresetSubmit
    // Now
    ,
    onNow: onNow
    // Render
    ,
    cellRender: onInternalCellRender
    // Styles
    ,
    classNames: mergedClassNames,
    styles: mergedStyles
  }));

  // ========================================================
  // ==                      Selector                      ==
  // ========================================================

  // ======================== Change ========================
  const onSelectorChange = (date, index) => {
    const clone = fillCalendarValue(date, index);
    triggerCalendarChange(clone);
  };
  const onSelectorInputChange = () => {
    lastOperation('input');
  };

  // ======================= Selector =======================
  const onSelectorFocus = (event, index) => {
    // Check if `needConfirm` but user not submit yet
    const activeListLen = activeIndexList.length;
    const lastActiveIndex = activeIndexList[activeListLen - 1];
    if (activeListLen && lastActiveIndex !== index && needConfirm &&
    // Not change index if is not filled
    !allowEmpty[lastActiveIndex] && !hasActiveSubmitValue(lastActiveIndex) && calendarValue[lastActiveIndex]) {
      selectorRef.current.focus({
        index: lastActiveIndex
      });
      return;
    }
    lastOperation('input');
    triggerOpen(true, {
      inherit: true
    });

    // When click input to switch the field, it will not trigger close.
    // Which means it will lose the part confirm and we need fill back.
    // ref: https://github.com/ant-design/ant-design/issues/49512
    if (activeIndex !== index && mergedOpen && !needConfirm && complexPicker) {
      triggerPartConfirm(null, true);
    }
    setActiveIndex(index);
    onSharedFocus(event, index);
  };
  const onSelectorBlur = (event, index) => {
    triggerOpen(false);
    if (!needConfirm && lastOperation() === 'input') {
      const nextIndex = nextActiveIndex(calendarValue);
      flushSubmit(activeIndex, nextIndex === null);
    }
    onSharedBlur(event, index);
  };
  const onSelectorKeyDown = (event, preventDefault) => {
    if (event.key === 'Tab') {
      triggerPartConfirm(null, true);
    }
    onKeyDown?.(event, preventDefault);
  };

  // ======================= Context ========================
  const context = React.useMemo(() => ({
    prefixCls,
    locale,
    generateConfig,
    button: components.button,
    input: components.input,
    classNames: mergedClassNames,
    styles: mergedStyles
  }), [prefixCls, locale, generateConfig, components.button, components.input, mergedClassNames, mergedStyles]);

  // ======================== Effect ========================
  // >>> Mode
  // Reset for every active
  (0, _util.useLayoutEffect)(() => {
    if (mergedOpen && activeIndex !== undefined) {
      // Legacy compatible. This effect update should not trigger `onPanelChange`
      triggerModeChange(null, picker, false);
    }
  }, [mergedOpen, activeIndex, picker]);

  // >>> For complex picker, we need check if need to focus next one
  (0, _util.useLayoutEffect)(() => {
    const lastOp = lastOperation();

    // Trade as confirm on field leave
    if (!mergedOpen && lastOp === 'input') {
      triggerOpen(false);
      triggerPartConfirm(null, true);
    }

    // Submit with complex picker
    if (!mergedOpen && complexPicker && !needConfirm && lastOp === 'panel') {
      triggerOpen(true);
      triggerPartConfirm();
    }
  }, [mergedOpen]);

  // ====================== DevWarning ======================
  if (process.env.NODE_ENV !== 'production') {
    const isIndexEmpty = index => {
      return (
        // Value is empty
        !value?.[index] &&
        // DefaultValue is empty
        !defaultValue?.[index]
      );
    };
    if (disabled.some((fieldDisabled, index) => fieldDisabled && isIndexEmpty(index) && !allowEmpty[index])) {
      (0, _util.warning)(false, '`disabled` should not set with empty `value`. You should set `allowEmpty` or `value` instead.');
    }
  }

  // ======================== Render ========================
  return /*#__PURE__*/React.createElement(_context.default.Provider, {
    value: context
  }, /*#__PURE__*/React.createElement(_PickerTrigger.default, _extends({}, (0, _util2.pickTriggerProps)(filledProps), {
    popupElement: panel,
    popupStyle: mergedStyles.popup.root,
    popupClassName: (0, _clsx.clsx)(rootClassName, mergedClassNames.popup.root)
    // Visible
    ,
    visible: mergedOpen,
    onClose: onPopupClose
    // Range
    ,
    range: true
  }), /*#__PURE__*/React.createElement(_RangeSelector.default
  // Shared
  , _extends({}, filledProps, {
    // Ref
    ref: selectorRef
    // Style
    ,
    className: (0, _clsx.clsx)(filledProps.className, rootClassName, mergedClassNames.root),
    style: {
      ...mergedStyles.root,
      ...filledProps.style
    }
    // Icon
    ,
    suffixIcon: suffixIcon
    // Active
    ,
    activeIndex: focused || mergedOpen ? activeIndex : null,
    activeHelp: !!internalHoverValues,
    allHelp: !!internalHoverValues && hoverSource === 'preset',
    focused: focused,
    onFocus: onSelectorFocus,
    onBlur: onSelectorBlur,
    onKeyDown: onSelectorKeyDown,
    onSubmit: triggerPartConfirm
    // Change
    ,
    value: hoverValues,
    maskFormat: maskFormat,
    onChange: onSelectorChange,
    onInputChange: onSelectorInputChange
    // Format
    ,
    format: formatList,
    inputReadOnly: inputReadOnly
    // Disabled
    ,
    disabled: disabled
    // Open
    ,
    open: mergedOpen,
    onOpenChange: triggerOpen
    // Click
    ,
    onClick: onSelectorClick,
    onClear: onSelectorClear
    // Invalid
    ,
    invalid: submitInvalidates,
    onInvalid: onSelectorInvalid
    // Offset
    ,
    onActiveInfo: setActiveInfo
  }))));
}
const RefRangePicker = /*#__PURE__*/React.forwardRef(RangePicker);
if (process.env.NODE_ENV !== 'production') {
  RefRangePicker.displayName = 'RefRangePicker';
}
var _default = exports.default = RefRangePicker;