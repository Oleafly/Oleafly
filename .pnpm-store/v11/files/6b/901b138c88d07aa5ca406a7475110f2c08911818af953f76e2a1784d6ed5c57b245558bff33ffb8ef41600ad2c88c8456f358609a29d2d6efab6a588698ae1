"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _clsx = require("clsx");
var _resizeObserver = _interopRequireDefault(require("@rc-component/resize-observer"));
var _util = require("@rc-component/util");
var React = _interopRequireWildcard(require("react"));
var _context = _interopRequireDefault(require("../context"));
var _useInputProps = _interopRequireDefault(require("./hooks/useInputProps"));
var _useRootProps = _interopRequireDefault(require("./hooks/useRootProps"));
var _Icon = _interopRequireDefault(require("./Icon"));
var _ClearIcon = _interopRequireDefault(require("./ClearIcon"));
var _Input = _interopRequireDefault(require("./Input"));
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
function RangeSelector(props, ref) {
  const {
    id,
    prefix,
    clearIcon,
    suffixIcon,
    separator = '~',
    activeIndex,
    activeHelp,
    allHelp,
    focused,
    onFocus,
    onBlur,
    onKeyDown,
    locale,
    generateConfig,
    // Placeholder
    placeholder,
    // Style
    className,
    style,
    // Click
    onClick,
    onClear,
    // Change
    value,
    onChange,
    onSubmit,
    onInputChange,
    // Valid
    format,
    maskFormat,
    preserveInvalidOnBlur,
    onInvalid,
    // Disabled
    disabled,
    invalid,
    inputReadOnly,
    // Direction
    direction,
    // Open
    onOpenChange,
    // Offset
    onActiveInfo,
    placement,
    // Native
    onMouseDown,
    // Input
    required,
    'aria-required': ariaRequired,
    autoFocus,
    tabIndex,
    ...restProps
  } = props;
  const rtl = direction === 'rtl';

  // ======================== Prefix ========================
  const {
    prefixCls,
    classNames,
    styles
  } = React.useContext(_context.default);

  // ========================== Id ==========================
  const ids = React.useMemo(() => {
    if (typeof id === 'string') {
      return [id];
    }
    const mergedId = id || {};
    return [mergedId.start, mergedId.end];
  }, [id]);

  // ========================= Refs =========================
  const rootRef = React.useRef();
  const inputStartRef = React.useRef();
  const inputEndRef = React.useRef();
  const getInput = index => [inputStartRef, inputEndRef][index]?.current;
  React.useImperativeHandle(ref, () => ({
    nativeElement: rootRef.current,
    focus: options => {
      if (typeof options === 'object') {
        const {
          index = 0,
          ...rest
        } = options || {};
        getInput(index)?.focus(rest);
      } else {
        getInput(options ?? 0)?.focus();
      }
    },
    blur: () => {
      getInput(0)?.blur();
      getInput(1)?.blur();
    }
  }));

  // ======================== Props =========================
  const rootProps = (0, _useRootProps.default)(restProps);

  // ===================== Placeholder ======================
  const mergedPlaceholder = React.useMemo(() => Array.isArray(placeholder) ? placeholder : [placeholder, placeholder], [placeholder]);

  // ======================== Inputs ========================
  const [getInputProps] = (0, _useInputProps.default)({
    ...props,
    id: ids,
    placeholder: mergedPlaceholder
  });

  // ====================== ActiveBar =======================
  const [activeBarStyle, setActiveBarStyle] = React.useState({
    position: 'absolute',
    width: 0
  });
  const syncActiveOffset = (0, _util.useEvent)(() => {
    const input = getInput(activeIndex);
    if (input) {
      const inputRect = input.nativeElement.getBoundingClientRect();
      const parentRect = rootRef.current.getBoundingClientRect();
      const rectOffset = inputRect.left - parentRect.left;
      setActiveBarStyle(ori => ({
        ...ori,
        width: inputRect.width,
        left: rectOffset
      }));
      onActiveInfo([inputRect.left, inputRect.right, parentRect.width]);
    }
  });
  React.useEffect(() => {
    syncActiveOffset();
  }, [activeIndex]);

  // ======================== Clear =========================
  const showClear = clearIcon && (value[0] && !disabled[0] || value[1] && !disabled[1]);

  // ======================= Disabled =======================
  const startAutoFocus = autoFocus && !disabled[0];
  const endAutoFocus = autoFocus && !startAutoFocus && !disabled[1];

  // ======================== Render ========================
  return /*#__PURE__*/React.createElement(_resizeObserver.default, {
    onResize: syncActiveOffset
  }, /*#__PURE__*/React.createElement("div", _extends({}, rootProps, {
    className: (0, _clsx.clsx)(prefixCls, `${prefixCls}-range`, {
      [`${prefixCls}-focused`]: focused,
      [`${prefixCls}-disabled`]: disabled.every(i => i),
      [`${prefixCls}-invalid`]: invalid.some(i => i),
      [`${prefixCls}-rtl`]: rtl
    }, className),
    style: style,
    ref: rootRef,
    onClick: onClick
    // Not lose current input focus
    ,
    onMouseDown: e => {
      const {
        target
      } = e;
      if (target !== inputStartRef.current.inputElement && target !== inputEndRef.current.inputElement) {
        e.preventDefault();
      }
      onMouseDown?.(e);
    }
  }), prefix && /*#__PURE__*/React.createElement("div", {
    className: (0, _clsx.clsx)(`${prefixCls}-prefix`, classNames.prefix),
    style: styles.prefix
  }, prefix), /*#__PURE__*/React.createElement(_Input.default, _extends({
    ref: inputStartRef
  }, getInputProps(0), {
    className: `${prefixCls}-input-start`,
    autoFocus: startAutoFocus,
    tabIndex: tabIndex,
    "date-range": "start"
  })), /*#__PURE__*/React.createElement("div", {
    className: `${prefixCls}-range-separator`
  }, separator), /*#__PURE__*/React.createElement(_Input.default, _extends({
    ref: inputEndRef
  }, getInputProps(1), {
    className: `${prefixCls}-input-end`,
    autoFocus: endAutoFocus,
    tabIndex: tabIndex,
    "date-range": "end"
  })), /*#__PURE__*/React.createElement("div", {
    className: `${prefixCls}-active-bar`,
    style: activeBarStyle
  }), /*#__PURE__*/React.createElement(_Icon.default, {
    icon: suffixIcon
  }), showClear && /*#__PURE__*/React.createElement(_ClearIcon.default, {
    icon: clearIcon,
    onClear: onClear
  })));
}
const RefRangeSelector = /*#__PURE__*/React.forwardRef(RangeSelector);
if (process.env.NODE_ENV !== 'production') {
  RefRangeSelector.displayName = 'RangeSelector';
}
var _default = exports.default = RefRangeSelector;