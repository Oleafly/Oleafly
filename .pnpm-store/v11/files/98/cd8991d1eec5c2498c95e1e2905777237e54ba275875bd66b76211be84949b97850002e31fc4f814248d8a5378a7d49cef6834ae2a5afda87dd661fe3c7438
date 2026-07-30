function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
import { clsx } from 'clsx';
import ResizeObserver from '@rc-component/resize-observer';
import { useEvent } from '@rc-component/util';
import * as React from 'react';
import PickerContext from "../context";
import useInputProps from "./hooks/useInputProps";
import useRootProps from "./hooks/useRootProps";
import Icon from "./Icon";
import ClearIcon from "./ClearIcon";
import Input from "./Input";
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
  } = React.useContext(PickerContext);

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
  const rootProps = useRootProps(restProps);

  // ===================== Placeholder ======================
  const mergedPlaceholder = React.useMemo(() => Array.isArray(placeholder) ? placeholder : [placeholder, placeholder], [placeholder]);

  // ======================== Inputs ========================
  const [getInputProps] = useInputProps({
    ...props,
    id: ids,
    placeholder: mergedPlaceholder
  });

  // ====================== ActiveBar =======================
  const [activeBarStyle, setActiveBarStyle] = React.useState({
    position: 'absolute',
    width: 0
  });
  const syncActiveOffset = useEvent(() => {
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
  return /*#__PURE__*/React.createElement(ResizeObserver, {
    onResize: syncActiveOffset
  }, /*#__PURE__*/React.createElement("div", _extends({}, rootProps, {
    className: clsx(prefixCls, `${prefixCls}-range`, {
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
    className: clsx(`${prefixCls}-prefix`, classNames.prefix),
    style: styles.prefix
  }, prefix), /*#__PURE__*/React.createElement(Input, _extends({
    ref: inputStartRef
  }, getInputProps(0), {
    className: `${prefixCls}-input-start`,
    autoFocus: startAutoFocus,
    tabIndex: tabIndex,
    "date-range": "start"
  })), /*#__PURE__*/React.createElement("div", {
    className: `${prefixCls}-range-separator`
  }, separator), /*#__PURE__*/React.createElement(Input, _extends({
    ref: inputEndRef
  }, getInputProps(1), {
    className: `${prefixCls}-input-end`,
    autoFocus: endAutoFocus,
    tabIndex: tabIndex,
    "date-range": "end"
  })), /*#__PURE__*/React.createElement("div", {
    className: `${prefixCls}-active-bar`,
    style: activeBarStyle
  }), /*#__PURE__*/React.createElement(Icon, {
    icon: suffixIcon
  }), showClear && /*#__PURE__*/React.createElement(ClearIcon, {
    icon: clearIcon,
    onClear: onClear
  })));
}
const RefRangeSelector = /*#__PURE__*/React.forwardRef(RangeSelector);
if (process.env.NODE_ENV !== 'production') {
  RefRangeSelector.displayName = 'RangeSelector';
}
export default RefRangeSelector;