"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var React = _interopRequireWildcard(require("react"));
var _Affix = _interopRequireDefault(require("./Affix"));
var _Content = _interopRequireDefault(require("./Content"));
var _context = _interopRequireDefault(require("./context"));
var _useBaseProps = _interopRequireDefault(require("../hooks/useBaseProps"));
var _util = require("@rc-component/util");
var _keyUtil = require("../utils/keyUtil");
var _clsx = require("clsx");
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
const DEFAULT_OMIT_PROPS = ['value', 'onChange', 'removeIcon', 'placeholder', 'maxTagCount', 'maxTagTextLength', 'maxTagPlaceholder', 'choiceTransitionName', 'onInputKeyDown', 'onPopupScroll', 'tabIndex', 'activeValue', 'onSelectorRemove', 'focused'];
var _default = exports.default = /*#__PURE__*/React.forwardRef(function SelectInput(props, ref) {
  const {
    // Style
    prefixCls,
    className,
    style,
    // UI
    prefix,
    suffix,
    clearIcon,
    children,
    // Data
    multiple,
    displayValues,
    placeholder,
    mode,
    // Search
    searchValue,
    onSearch,
    onSearchSubmit,
    onInputBlur,
    // Input
    maxLength,
    autoFocus,
    // Events
    onMouseDown,
    onClearMouseDown,
    onInputKeyDown,
    onSelectorRemove,
    // Token handling
    tokenWithEnter,
    // Components
    components,
    ...restProps
  } = props;
  const {
    triggerOpen,
    toggleOpen,
    showSearch,
    disabled,
    loading,
    classNames,
    styles
  } = (0, _useBaseProps.default)();
  const rootRef = React.useRef(null);
  const inputRef = React.useRef(null);

  // Handle keyboard events similar to original Selector
  const onInternalInputKeyDown = (0, _util.useEvent)(event => {
    const {
      which
    } = event;

    // Compatible with multiple lines in TextArea
    const isTextAreaElement = inputRef.current instanceof HTMLTextAreaElement;

    // Prevent default behavior for up/down arrows when dropdown is open
    if (!isTextAreaElement && triggerOpen && (which === _util.KeyCode.UP || which === _util.KeyCode.DOWN)) {
      event.preventDefault();
    }

    // Call the original onInputKeyDown callback
    if (onInputKeyDown) {
      onInputKeyDown(event);
    }

    // Move within the text box for TextArea
    if (isTextAreaElement && !triggerOpen && ~[_util.KeyCode.UP, _util.KeyCode.DOWN, _util.KeyCode.LEFT, _util.KeyCode.RIGHT].indexOf(which)) {
      return;
    }

    // Open dropdown when a valid open key is pressed
    const isModifier = event.ctrlKey || event.altKey || event.metaKey;
    if (!isModifier && (0, _keyUtil.isValidateOpenKey)(which)) {
      toggleOpen(true);
    }
  });

  // ====================== Refs ======================
  React.useImperativeHandle(ref, () => {
    return {
      focus: options => {
        // Focus the inner input if available, otherwise fall back to root div.
        (inputRef.current || rootRef.current).focus?.(options);
      },
      blur: () => {
        (inputRef.current || rootRef.current).blur?.();
      },
      // Use getDOM to handle nested nativeElement structure (e.g., when RootComponent is antd Input)
      nativeElement: (0, _util.getDOM)(rootRef.current)
    };
  });

  // ====================== Open ======================
  const onInternalMouseDown = (0, _util.useEvent)(event => {
    if (!disabled) {
      const inputDOM = (0, _util.getDOM)(inputRef.current);

      // https://github.com/ant-design/ant-design/issues/56002
      // Tell `useSelectTriggerControl` to ignore this event
      // When icon is dynamic render, the parentNode will miss
      // so we need to mark the event directly
      event.nativeEvent._ori_target = inputDOM;
      const isClickOnInput = inputDOM === event.target || inputDOM?.contains(event.target);
      if (inputDOM && !isClickOnInput) {
        event.preventDefault();
      }

      // Check if we should prevent closing when clicking on selector
      // Don't close if: open && not multiple && (combobox mode || showSearch)
      const shouldPreventCloseOnSingle = triggerOpen && !multiple && (mode === 'combobox' || showSearch);

      // Don't close if: open && multiple && click on input
      const shouldPreventCloseOnMultipleInput = triggerOpen && multiple && isClickOnInput;
      const shouldPreventClose = shouldPreventCloseOnSingle || shouldPreventCloseOnMultipleInput;
      if (!event.nativeEvent._select_lazy) {
        inputRef.current?.focus();

        // Only toggle open if we should not prevent close
        if (!shouldPreventClose) {
          toggleOpen();
        }
      } else if (triggerOpen && !multiple) {
        // Lazy should also close when click clear icon in single select.
        toggleOpen(false);
      }
    }
    onMouseDown?.(event);
  });

  // =================== Components ===================
  const {
    root: RootComponent
  } = components;

  // ===================== Render =====================
  const domProps = (0, _util.omit)(restProps, DEFAULT_OMIT_PROPS);
  const ariaProps = (0, _util.pickAttrs)(domProps, {
    aria: true
  });
  const ariaKeys = Object.keys(ariaProps);

  // Create context value with wrapped callbacks
  const contextValue = {
    ...props,
    onInputKeyDown: onInternalInputKeyDown
  };
  if (RootComponent) {
    const originProps = RootComponent.props || {};
    const mergedProps = {
      ...originProps,
      ...domProps
    };
    Object.keys(originProps).forEach(key => {
      const originVal = originProps[key];
      const domVal = domProps[key];
      if (typeof originVal === 'function' && typeof domVal === 'function') {
        mergedProps[key] = (...args) => {
          domVal(...args);
          originVal(...args);
        };
      }
    });
    if ( /*#__PURE__*/React.isValidElement(RootComponent)) {
      return /*#__PURE__*/React.cloneElement(RootComponent, {
        ...mergedProps,
        ref: (0, _util.composeRef)(RootComponent.ref, rootRef)
      });
    }
    return /*#__PURE__*/React.createElement(RootComponent, _extends({}, mergedProps, {
      ref: rootRef
    }));
  }
  return /*#__PURE__*/React.createElement(_context.default.Provider, {
    value: contextValue
  }, /*#__PURE__*/React.createElement("div", _extends({}, (0, _util.omit)(domProps, ariaKeys), {
    // Style
    ref: rootRef,
    className: className,
    style: style
    // Mouse Events
    ,
    onMouseDown: onInternalMouseDown
  }), /*#__PURE__*/React.createElement(_Affix.default, {
    className: (0, _clsx.clsx)(`${prefixCls}-prefix`, classNames?.prefix),
    style: styles?.prefix
  }, prefix), /*#__PURE__*/React.createElement(_Content.default, {
    ref: inputRef
  }), /*#__PURE__*/React.createElement(_Affix.default, {
    className: (0, _clsx.clsx)(`${prefixCls}-suffix`, {
      [`${prefixCls}-suffix-loading`]: loading
    }, classNames?.suffix),
    style: styles?.suffix
  }, suffix), clearIcon && /*#__PURE__*/React.createElement(_Affix.default, {
    className: (0, _clsx.clsx)(`${prefixCls}-clear`, classNames?.clear),
    style: styles?.clear,
    onMouseDown: e => {
      // Mark to tell not trigger open or focus
      e.nativeEvent._select_lazy = true;
      onClearMouseDown?.(e);
    }
  }, clearIcon), children));
});