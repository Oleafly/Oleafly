"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = PopupPanel;
var React = _interopRequireWildcard(require("react"));
var _PickerPanel = _interopRequireDefault(require("../../PickerPanel"));
var _context = require("../../PickerPanel/context");
var _context2 = _interopRequireDefault(require("../context"));
var _useRangePickerValue = require("../hooks/useRangePickerValue");
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
function PopupPanel(props) {
  const {
    picker,
    multiplePanel,
    pickerValue,
    onPickerValueChange,
    needConfirm,
    onSubmit,
    range,
    hoverValue
  } = props;
  const {
    prefixCls,
    generateConfig
  } = React.useContext(_context2.default);

  // ======================== Offset ========================
  const internalOffsetDate = React.useCallback((date, offset) => {
    return (0, _useRangePickerValue.offsetPanelDate)(generateConfig, picker, date, offset);
  }, [generateConfig, picker]);
  const nextPickerValue = React.useMemo(() => internalOffsetDate(pickerValue, 1), [pickerValue, internalOffsetDate]);

  // Outside
  const onSecondPickerValueChange = nextDate => {
    onPickerValueChange(internalOffsetDate(nextDate, -1));
  };

  // ======================= Context ========================
  const sharedContext = {
    onCellDblClick: () => {
      if (needConfirm) {
        onSubmit();
      }
    }
  };
  const hideHeader = picker === 'time';

  // ======================== Props =========================
  const pickerProps = {
    ...props,
    hoverValue: null,
    hoverRangeValue: null,
    hideHeader
  };
  if (range) {
    pickerProps.hoverRangeValue = hoverValue;
  } else {
    pickerProps.hoverValue = hoverValue;
  }

  // ======================== Render ========================
  // Multiple
  if (multiplePanel) {
    return /*#__PURE__*/React.createElement("div", {
      className: `${prefixCls}-panels`
    }, /*#__PURE__*/React.createElement(_context.PickerHackContext.Provider, {
      value: {
        ...sharedContext,
        hideNext: true
      }
    }, /*#__PURE__*/React.createElement(_PickerPanel.default, pickerProps)), /*#__PURE__*/React.createElement(_context.PickerHackContext.Provider, {
      value: {
        ...sharedContext,
        hidePrev: true
      }
    }, /*#__PURE__*/React.createElement(_PickerPanel.default, _extends({}, pickerProps, {
      pickerValue: nextPickerValue,
      onPickerValueChange: onSecondPickerValueChange
    }))));
  }

  // Single
  return /*#__PURE__*/React.createElement(_context.PickerHackContext.Provider, {
    value: {
      ...sharedContext
    }
  }, /*#__PURE__*/React.createElement(_PickerPanel.default, pickerProps));
}