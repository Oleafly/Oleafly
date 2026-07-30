"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _clsx = require("clsx");
var _resizeObserver = _interopRequireDefault(require("@rc-component/resize-observer"));
var _util = require("@rc-component/util");
var React = _interopRequireWildcard(require("react"));
var _calculateNodeHeight = _interopRequireDefault(require("./calculateNodeHeight"));
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
const RESIZE_START = 0;
const RESIZE_MEASURING = 1;
const RESIZE_STABLE = 2;
const ResizableTextArea = /*#__PURE__*/React.forwardRef((props, ref) => {
  const {
    prefixCls,
    defaultValue,
    value,
    autoSize,
    onResize,
    className,
    style,
    disabled,
    onChange,
    // Test only
    onInternalAutoSize,
    ...restProps
  } = props;

  // =============================== Value ================================
  const [internalValue, setMergedValue] = (0, _util.useControlledState)(defaultValue, value);
  const mergedValue = internalValue ?? '';
  const onInternalChange = event => {
    setMergedValue(event.target.value);
    onChange?.(event);
  };

  // ================================ Ref =================================
  const textareaRef = React.useRef(null);
  React.useImperativeHandle(ref, () => ({
    textArea: textareaRef.current
  }));

  // ============================== AutoSize ==============================
  const [minRows, maxRows] = React.useMemo(() => {
    if (autoSize && typeof autoSize === 'object') {
      return [autoSize.minRows, autoSize.maxRows];
    }
    return [];
  }, [autoSize]);
  const needAutoSize = !!autoSize;

  // =============================== Resize ===============================
  const [resizeState, setResizeState] = React.useState(RESIZE_STABLE);
  const [autoSizeStyle, setAutoSizeStyle] = React.useState();
  const startResize = () => {
    setResizeState(RESIZE_START);
    if (process.env.NODE_ENV === 'test') {
      onInternalAutoSize?.();
    }
  };

  // Change to trigger resize measure
  (0, _util.useLayoutEffect)(() => {
    if (needAutoSize) {
      startResize();
    }
  }, [value, minRows, maxRows, needAutoSize]);
  (0, _util.useLayoutEffect)(() => {
    if (resizeState === RESIZE_START) {
      setResizeState(RESIZE_MEASURING);
    } else if (resizeState === RESIZE_MEASURING) {
      const textareaStyles = (0, _calculateNodeHeight.default)(textareaRef.current, false, minRows, maxRows);
      setResizeState(RESIZE_STABLE);
      setAutoSizeStyle(textareaStyles);
    } else {
      // https://github.com/react-component/textarea/pull/23
      // Firefox has blink issue before but fixed in latest version.
    }
  }, [resizeState]);

  // We lock resize trigger by raf to avoid Safari warning
  const resizeRafRef = React.useRef(undefined);
  const cleanRaf = () => {
    if (resizeRafRef.current !== undefined) {
      _util.raf.cancel(resizeRafRef.current);
    }
  };
  const onInternalResize = size => {
    if (resizeState === RESIZE_STABLE) {
      onResize?.(size);
      if (autoSize) {
        cleanRaf();
        resizeRafRef.current = (0, _util.raf)(() => {
          startResize();
        });
      }
    }
  };
  React.useEffect(() => cleanRaf, []);

  // =============================== Render ===============================
  const mergedAutoSizeStyle = needAutoSize ? autoSizeStyle : null;
  const mergedStyle = {
    ...style,
    ...mergedAutoSizeStyle
  };
  if (resizeState === RESIZE_START || resizeState === RESIZE_MEASURING) {
    mergedStyle.overflowY = 'hidden';
    mergedStyle.overflowX = 'hidden';
  }
  return /*#__PURE__*/React.createElement(_resizeObserver.default, {
    onResize: onInternalResize,
    disabled: !(autoSize || onResize)
  }, /*#__PURE__*/React.createElement("textarea", _extends({}, restProps, {
    ref: textareaRef,
    style: mergedStyle,
    className: (0, _clsx.clsx)(prefixCls, className, {
      [`${prefixCls}-disabled`]: disabled
    }),
    disabled: disabled,
    value: mergedValue,
    onChange: onInternalChange
  })));
});
var _default = exports.default = ResizableTextArea;