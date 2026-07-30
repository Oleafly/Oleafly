"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _clsx = require("clsx");
var _util = require("@rc-component/util");
var React = _interopRequireWildcard(require("react"));
var _miscUtil = require("../../utils/miscUtil");
var _context = _interopRequireDefault(require("../context"));
var _useLockEffect = _interopRequireDefault(require("../hooks/useLockEffect"));
var _Icon = _interopRequireDefault(require("./Icon"));
var _MaskFormat = _interopRequireDefault(require("./MaskFormat"));
var _util2 = require("./util");
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
// Format logic
//
// First time on focus:
//  1. check if the text is valid, if not fill with format
//  2. set highlight cell to the first cell
// Cells
//  1. Selection the index cell, set inner `cacheValue` to ''
//  2. Key input filter non-number char, patch after the `cacheValue`
//    1. Replace the `cacheValue` with input align the cell length
//    2. Re-selection the mask cell
//  3. If `cacheValue` match the limit length or cell format (like 1 ~ 12 month), go to next cell

const Input = /*#__PURE__*/React.forwardRef((props, ref) => {
  const {
    className,
    active,
    showActiveCls = true,
    suffixIcon,
    format,
    validateFormat,
    onChange,
    onInput,
    helped,
    onHelp,
    onSubmit,
    onKeyDown,
    preserveInvalidOnBlur = false,
    invalid,
    clearIcon,
    // Pass to input
    ...restProps
  } = props;
  const {
    value,
    onFocus,
    onBlur,
    onMouseUp
  } = props;
  const {
    prefixCls,
    input: Component = 'input',
    classNames,
    styles
  } = React.useContext(_context.default);
  const inputPrefixCls = `${prefixCls}-input`;

  // ======================== Value =========================
  const [focused, setFocused] = React.useState(false);
  const [internalInputValue, setInputValue] = React.useState(value);
  const [focusCellText, setFocusCellText] = React.useState('');
  const [focusCellIndex, setFocusCellIndex] = React.useState(null);
  const [forceSelectionSyncMark, forceSelectionSync] = React.useState(null);
  const inputValue = internalInputValue || '';

  // Sync value if needed
  React.useEffect(() => {
    setInputValue(value);
  }, [value]);

  // ========================= Refs =========================
  const holderRef = React.useRef(null);
  const inputRef = React.useRef(null);
  // When mousedown get focus, defer selection to mouseUp so click position is used
  const mouseDownRef = React.useRef(false);
  React.useImperativeHandle(ref, () => ({
    nativeElement: holderRef.current,
    inputElement: inputRef.current,
    focus: options => {
      inputRef.current.focus(options);
    },
    blur: () => {
      inputRef.current.blur();
    }
  }));

  // ======================== Format ========================
  const maskFormat = React.useMemo(() => new _MaskFormat.default(format || ''), [format]);
  const [selectionStart, selectionEnd] = React.useMemo(() => {
    if (helped) {
      return [0, 0];
    }
    return maskFormat.getSelection(focusCellIndex);
  }, [maskFormat, focusCellIndex, helped]);

  // ======================== Modify ========================
  // When input modify content, trigger `onHelp` if is not the format
  const onModify = text => {
    if (text && text !== format && text !== value) {
      onHelp();
    }
  };

  // ======================== Change ========================
  /**
   * Triggered by paste, keyDown and focus to show format
   */
  const triggerInputChange = (0, _util.useEvent)(text => {
    if (validateFormat(text)) {
      onChange(text);
    }
    setInputValue(text);
    onModify(text);
  });

  // Directly trigger `onChange` if `format` is empty
  const onInternalChange = event => {
    // Hack `onChange` with format to do nothing
    if (!format) {
      const text = event.target.value;
      onModify(text);
      setInputValue(text);
      onChange(text);
    }
  };
  const onFormatPaste = event => {
    // Block paste until selection is set (after mouseUp when focus was by mousedown)
    if (mouseDownRef.current) {
      event.preventDefault();
      return;
    }

    // Get paste text
    const pasteText = event.clipboardData.getData('text');
    if (validateFormat(pasteText)) {
      triggerInputChange(pasteText);
    }
  };

  // ======================== Mouse =========================
  // When `mouseDown` get focus, it's better to not to change the selection
  // Since the up position maybe not is the first cell
  const onFormatMouseDown = () => {
    mouseDownRef.current = true;
  };
  const onFormatMouseUp = event => {
    const {
      selectionStart: start
    } = event.target;
    const closeMaskIndex = maskFormat.getMaskCellIndex(start);
    setFocusCellIndex(closeMaskIndex);

    // Force update the selection
    forceSelectionSync({});
    onMouseUp?.(event);
    mouseDownRef.current = false;
  };

  // ====================== Focus Blur ======================
  const onFormatFocus = event => {
    setFocused(true);
    setFocusCellIndex(0);
    setFocusCellText('');
    onFocus(event);
  };
  const onSharedBlur = event => {
    onBlur(event);
  };
  const onFormatBlur = event => {
    setFocused(false);
    onSharedBlur(event);
  };

  // ======================== Active ========================
  // Check if blur need reset input value
  (0, _useLockEffect.default)(active, () => {
    if (!active && !preserveInvalidOnBlur) {
      setInputValue(value);
    }
  });

  // ======================= Keyboard =======================
  const onSharedKeyDown = event => {
    if (event.key === 'Enter' && validateFormat(inputValue)) {
      onSubmit();
    }
    onKeyDown?.(event);
  };
  const onFormatKeyDown = event => {
    // Block key input until selection is set (after mouseUp when focus was by mousedown)
    if (mouseDownRef.current) {
      event.preventDefault();
      return;
    }
    onSharedKeyDown(event);
    const {
      key
    } = event;

    // Save the cache with cell text
    let nextCellText = null;

    // Fill in the input
    let nextFillText = null;
    const maskCellLen = selectionEnd - selectionStart;
    const cellFormat = format.slice(selectionStart, selectionEnd);

    // Cell Index
    const offsetCellIndex = offset => {
      setFocusCellIndex(idx => {
        let nextIndex = idx + offset;
        nextIndex = Math.max(nextIndex, 0);
        nextIndex = Math.min(nextIndex, maskFormat.size() - 1);
        return nextIndex;
      });
    };

    // Range
    const offsetCellValue = offset => {
      const [rangeStart, rangeEnd, rangeDefault] = (0, _util2.getMaskRange)(cellFormat);
      const currentText = inputValue.slice(selectionStart, selectionEnd);
      const currentTextNum = Number(currentText);
      if (isNaN(currentTextNum)) {
        return String(rangeDefault ? rangeDefault : offset > 0 ? rangeStart : rangeEnd);
      }
      const num = currentTextNum + offset;
      const range = rangeEnd - rangeStart + 1;
      return String(rangeStart + (range + num - rangeStart) % range);
    };
    switch (key) {
      // =============== Remove ===============
      case 'Backspace':
      case 'Delete':
        nextCellText = '';
        nextFillText = cellFormat;
        break;

      // =============== Arrows ===============
      // Left key
      case 'ArrowLeft':
        nextCellText = '';
        offsetCellIndex(-1);
        break;

      // Right key
      case 'ArrowRight':
        nextCellText = '';
        offsetCellIndex(1);
        break;

      // Up key
      case 'ArrowUp':
        nextCellText = '';
        nextFillText = offsetCellValue(1);
        break;

      // Down key
      case 'ArrowDown':
        nextCellText = '';
        nextFillText = offsetCellValue(-1);
        break;

      // =============== Number ===============
      default:
        if (!isNaN(Number(key))) {
          nextCellText = focusCellText + key;
          nextFillText = nextCellText;
        }
        break;
    }

    // Update cell text
    if (nextCellText !== null) {
      setFocusCellText(nextCellText);
      if (nextCellText.length >= maskCellLen) {
        // Go to next cell
        offsetCellIndex(1);
        setFocusCellText('');
      }
    }

    // Update the input text
    if (nextFillText !== null) {
      // Replace selection range with `nextCellText`
      const nextFocusValue =
      // before
      inputValue.slice(0, selectionStart) +
      // replace
      (0, _miscUtil.leftPad)(nextFillText, maskCellLen) +
      // after
      inputValue.slice(selectionEnd);
      triggerInputChange(nextFocusValue.slice(0, format.length));
    }

    // Always trigger selection sync after key down
    forceSelectionSync({});
  };

  // ======================== Format ========================
  const rafRef = React.useRef();
  (0, _util.useLayoutEffect)(() => {
    if (!focused || !format || mouseDownRef.current) {
      return;
    }

    // Reset with format if not match
    if (!maskFormat.match(inputValue)) {
      triggerInputChange(format);
      return;
    }

    // Match the selection range
    inputRef.current.setSelectionRange(selectionStart, selectionEnd);

    // Chrome has the bug anchor position looks not correct but actually correct
    rafRef.current = (0, _util.raf)(() => {
      inputRef.current.setSelectionRange(selectionStart, selectionEnd);
    });
    return () => {
      _util.raf.cancel(rafRef.current);
    };
  }, [maskFormat, format, focused, inputValue, focusCellIndex, selectionStart, selectionEnd, forceSelectionSyncMark, triggerInputChange]);

  // ======================== Render ========================
  // Input props for format
  const inputProps = format ? {
    onFocus: onFormatFocus,
    onBlur: onFormatBlur,
    onKeyDown: onFormatKeyDown,
    onMouseDown: onFormatMouseDown,
    onMouseUp: onFormatMouseUp,
    onPaste: onFormatPaste
  } : {};
  return /*#__PURE__*/React.createElement("div", {
    ref: holderRef,
    className: (0, _clsx.clsx)(inputPrefixCls, {
      [`${inputPrefixCls}-active`]: active && showActiveCls,
      [`${inputPrefixCls}-placeholder`]: helped
    }, className)
  }, /*#__PURE__*/React.createElement(Component, _extends({
    ref: inputRef,
    "aria-invalid": invalid,
    autoComplete: "off"
  }, restProps, {
    onKeyDown: onSharedKeyDown,
    onBlur: onSharedBlur
    // Replace with format
  }, inputProps, {
    // Value
    value: inputValue,
    onChange: onInternalChange,
    className: classNames.input,
    style: styles.input
  })), /*#__PURE__*/React.createElement(_Icon.default, {
    icon: suffixIcon
  }), clearIcon);
});
if (process.env.NODE_ENV !== 'production') {
  Input.displayName = 'Input';
}
var _default = exports.default = Input;