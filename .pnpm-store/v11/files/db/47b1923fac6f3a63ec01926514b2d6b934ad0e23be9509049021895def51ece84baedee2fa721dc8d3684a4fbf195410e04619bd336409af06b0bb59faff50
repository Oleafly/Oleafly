"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _clsx = require("clsx");
var React = _interopRequireWildcard(require("react"));
var _dateUtil = require("../../../utils/dateUtil");
var _context = _interopRequireDefault(require("../../context"));
var _Icon = _interopRequireDefault(require("../Icon"));
var _ClearIcon = _interopRequireDefault(require("../ClearIcon"));
var _Input = _interopRequireDefault(require("../Input"));
var _useInputProps = _interopRequireDefault(require("../hooks/useInputProps"));
var _useRootProps = _interopRequireDefault(require("../hooks/useRootProps"));
var _MultipleDates = _interopRequireDefault(require("./MultipleDates"));
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
function SingleSelector(props, ref) {
  const {
    id,
    open,
    prefix,
    clearIcon,
    suffixIcon,
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
    internalPicker,
    value,
    onChange,
    onSubmit,
    onInputChange,
    multiple,
    maxTagCount,
    tagRender,
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
    // Native
    onMouseDown,
    // Input
    required,
    'aria-required': ariaRequired,
    autoFocus,
    tabIndex,
    removeIcon,
    ...restProps
  } = props;
  const rtl = direction === 'rtl';

  // ======================== Prefix ========================
  const {
    prefixCls,
    classNames,
    styles
  } = React.useContext(_context.default);

  // ========================= Refs =========================
  const rootRef = React.useRef();
  const inputRef = React.useRef();
  React.useImperativeHandle(ref, () => ({
    nativeElement: rootRef.current,
    focus: options => {
      inputRef.current?.focus(options);
    },
    blur: () => {
      inputRef.current?.blur();
    }
  }));

  // ======================== Props =========================
  const rootProps = (0, _useRootProps.default)(restProps);

  // ======================== Change ========================
  const onSingleChange = date => {
    onChange([date]);
  };
  const onMultipleRemove = date => {
    const nextValues = value.filter(oriDate => oriDate && !(0, _dateUtil.isSame)(generateConfig, locale, oriDate, date, internalPicker));
    onChange(nextValues);

    // When `open`, it means user is operating the
    if (!open) {
      onSubmit();
    }
  };

  // ======================== Inputs ========================
  const [getInputProps, getText] = (0, _useInputProps.default)({
    ...props,
    onChange: onSingleChange
  }, ({
    valueTexts
  }) => ({
    value: valueTexts[0] || '',
    active: focused
  }));

  // ======================== Clear =========================
  const showClear = !!(clearIcon && value.length && !disabled);

  // ======================= Multiple =======================
  const selectorNode = multiple ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(_MultipleDates.default, {
    prefixCls: prefixCls,
    value: value,
    onRemove: onMultipleRemove,
    formatDate: getText,
    maxTagCount: maxTagCount,
    tagRender: tagRender,
    disabled: disabled,
    removeIcon: removeIcon,
    placeholder: placeholder
  }), /*#__PURE__*/React.createElement("input", {
    className: `${prefixCls}-multiple-input`,
    value: value.map(getText).join(','),
    ref: inputRef,
    readOnly: true,
    autoFocus: autoFocus,
    tabIndex: tabIndex
  }), /*#__PURE__*/React.createElement(_Icon.default, {
    icon: suffixIcon
  }), showClear && /*#__PURE__*/React.createElement(_ClearIcon.default, {
    icon: clearIcon,
    onClear: onClear
  })) : /*#__PURE__*/React.createElement(_Input.default, _extends({
    ref: inputRef
  }, getInputProps(), {
    autoFocus: autoFocus,
    tabIndex: tabIndex,
    suffixIcon: suffixIcon,
    clearIcon: showClear && /*#__PURE__*/React.createElement(_ClearIcon.default, {
      icon: clearIcon,
      onClear: onClear
    }),
    showActiveCls: false
  }));

  // ======================== Render ========================
  return /*#__PURE__*/React.createElement("div", _extends({}, rootProps, {
    className: (0, _clsx.clsx)(prefixCls, {
      [`${prefixCls}-multiple`]: multiple,
      [`${prefixCls}-focused`]: focused,
      [`${prefixCls}-disabled`]: disabled,
      [`${prefixCls}-invalid`]: invalid,
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
      if (target !== inputRef.current?.inputElement) {
        e.preventDefault();
      }
      onMouseDown?.(e);
    }
  }), prefix && /*#__PURE__*/React.createElement("div", {
    className: (0, _clsx.clsx)(`${prefixCls}-prefix`, classNames.prefix),
    style: styles.prefix
  }, prefix), selectorNode);
}
const RefSingleSelector = /*#__PURE__*/React.forwardRef(SingleSelector);
if (process.env.NODE_ENV !== 'production') {
  RefSingleSelector.displayName = 'SingleSelector';
}
var _default = exports.default = RefSingleSelector;