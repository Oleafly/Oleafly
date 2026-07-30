"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SharedPanelContext = exports.PickerHackContext = exports.PanelContext = void 0;
exports.useInfo = useInfo;
exports.usePanelContext = usePanelContext;
var React = _interopRequireWildcard(require("react"));
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
const SharedPanelContext = exports.SharedPanelContext = /*#__PURE__*/React.createContext(null);
/** Used for each single Panel. e.g. DatePanel */
const PanelContext = exports.PanelContext = /*#__PURE__*/React.createContext(null);
function usePanelContext() {
  return React.useContext(PanelContext);
}

/**
 * Get shared props for the SharedPanelProps interface.
 */
function useInfo(props, panelType) {
  // TODO: this is not good to get from each props.
  // Should move to `SharedPanelContext` instead.
  const {
    prefixCls,
    generateConfig,
    locale,
    disabledDate,
    minDate,
    maxDate,
    cellRender,
    hoverValue,
    hoverRangeValue,
    onHover,
    values,
    pickerValue,
    onSelect,
    // Icons
    prevIcon,
    nextIcon,
    superPrevIcon,
    superNextIcon
  } = props;

  // ======================= Context ========================
  const {
    classNames,
    styles
  } = React.useContext(SharedPanelContext);

  // ========================= MISC =========================
  const now = generateConfig.getNow();

  // ========================= Info =========================
  const info = {
    now,
    values,
    pickerValue,
    prefixCls,
    classNames,
    styles,
    disabledDate,
    minDate,
    maxDate,
    cellRender,
    hoverValue,
    hoverRangeValue,
    onHover,
    locale,
    generateConfig,
    onSelect,
    panelType,
    // Icons
    prevIcon,
    nextIcon,
    superPrevIcon,
    superNextIcon
  };
  return [info, now];
}

// ============================== Internal ==============================

/**
 * Internal usage for RangePicker to not to show the operation arrow
 */
const PickerHackContext = exports.PickerHackContext = /*#__PURE__*/React.createContext({});
if (process.env.NODE_ENV !== 'production') {
  PickerHackContext.displayName = 'PickerHackContext';
}