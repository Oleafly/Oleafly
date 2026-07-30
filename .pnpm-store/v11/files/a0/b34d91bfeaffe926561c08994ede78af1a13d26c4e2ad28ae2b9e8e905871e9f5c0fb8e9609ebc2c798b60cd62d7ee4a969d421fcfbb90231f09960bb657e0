function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
import * as React from 'react';
import Affix from "./Affix";
import SelectContent from "./Content";
import SelectInputContext from "./context";
import useBaseProps from "../hooks/useBaseProps";
import { composeRef, getDOM, KeyCode, omit, pickAttrs, useEvent } from '@rc-component/util';
import { isValidateOpenKey } from "../utils/keyUtil";
import { clsx } from 'clsx';
const DEFAULT_OMIT_PROPS = ['value', 'onChange', 'removeIcon', 'placeholder', 'maxTagCount', 'maxTagTextLength', 'maxTagPlaceholder', 'choiceTransitionName', 'onInputKeyDown', 'onPopupScroll', 'tabIndex', 'activeValue', 'onSelectorRemove', 'focused'];
export default /*#__PURE__*/React.forwardRef(function SelectInput(props, ref) {
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
  } = useBaseProps();
  const rootRef = React.useRef(null);
  const inputRef = React.useRef(null);

  // Handle keyboard events similar to original Selector
  const onInternalInputKeyDown = useEvent(event => {
    const {
      which
    } = event;

    // Compatible with multiple lines in TextArea
    const isTextAreaElement = inputRef.current instanceof HTMLTextAreaElement;

    // Prevent default behavior for up/down arrows when dropdown is open
    if (!isTextAreaElement && triggerOpen && (which === KeyCode.UP || which === KeyCode.DOWN)) {
      event.preventDefault();
    }

    // Call the original onInputKeyDown callback
    if (onInputKeyDown) {
      onInputKeyDown(event);
    }

    // Move within the text box for TextArea
    if (isTextAreaElement && !triggerOpen && ~[KeyCode.UP, KeyCode.DOWN, KeyCode.LEFT, KeyCode.RIGHT].indexOf(which)) {
      return;
    }

    // Open dropdown when a valid open key is pressed
    const isModifier = event.ctrlKey || event.altKey || event.metaKey;
    if (!isModifier && isValidateOpenKey(which)) {
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
      nativeElement: getDOM(rootRef.current)
    };
  });

  // ====================== Open ======================
  const onInternalMouseDown = useEvent(event => {
    if (!disabled) {
      const inputDOM = getDOM(inputRef.current);

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
  const domProps = omit(restProps, DEFAULT_OMIT_PROPS);
  const ariaProps = pickAttrs(domProps, {
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
        ref: composeRef(RootComponent.ref, rootRef)
      });
    }
    return /*#__PURE__*/React.createElement(RootComponent, _extends({}, mergedProps, {
      ref: rootRef
    }));
  }
  return /*#__PURE__*/React.createElement(SelectInputContext.Provider, {
    value: contextValue
  }, /*#__PURE__*/React.createElement("div", _extends({}, omit(domProps, ariaKeys), {
    // Style
    ref: rootRef,
    className: className,
    style: style
    // Mouse Events
    ,
    onMouseDown: onInternalMouseDown
  }), /*#__PURE__*/React.createElement(Affix, {
    className: clsx(`${prefixCls}-prefix`, classNames?.prefix),
    style: styles?.prefix
  }, prefix), /*#__PURE__*/React.createElement(SelectContent, {
    ref: inputRef
  }), /*#__PURE__*/React.createElement(Affix, {
    className: clsx(`${prefixCls}-suffix`, {
      [`${prefixCls}-suffix-loading`]: loading
    }, classNames?.suffix),
    style: styles?.suffix
  }, suffix), clearIcon && /*#__PURE__*/React.createElement(Affix, {
    className: clsx(`${prefixCls}-clear`, classNames?.clear),
    style: styles?.clear,
    onMouseDown: e => {
      // Mark to tell not trigger open or focus
      e.nativeEvent._select_lazy = true;
      onClearMouseDown?.(e);
    }
  }, clearIcon), children));
});