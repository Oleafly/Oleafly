function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
import { clsx } from 'clsx';
import { omit, triggerFocus } from '@rc-component/util';
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import BaseInput from "./BaseInput";
import useCount from "./hooks/useCount";
import useCountDisplay from "./hooks/useCountDisplay";
import useCountExceed from "./hooks/useCountExceed";
import useMergedValue from "./hooks/useMergedValue";
import { resolveOnChange } from "./utils/commonUtils";
const Input = /*#__PURE__*/forwardRef((props, ref) => {
  const {
    autoComplete,
    onChange,
    onFocus,
    onBlur,
    onPressEnter,
    onKeyDown,
    onKeyUp,
    prefixCls = 'rc-input',
    disabled,
    htmlSize,
    className,
    maxLength,
    suffix,
    showCount,
    count,
    type = 'text',
    classes,
    classNames,
    styles,
    onCompositionStart,
    onCompositionEnd,
    ...rest
  } = props;
  const [focused, setFocused] = useState(false);
  const compositionRef = useRef(false);
  const keyLockRef = useRef(false);
  const inputRef = useRef(null);
  const holderRef = useRef(null);
  const focus = option => {
    if (inputRef.current) {
      triggerFocus(inputRef.current, option);
    }
  };

  // ====================== Value =======================
  const {
    setValue,
    formatValue
  } = useMergedValue(props.defaultValue, props.value);
  const countConfig = useCount(count, showCount);
  const {
    isOutOfRange,
    dataCount
  } = useCountDisplay({
    countConfig,
    value: formatValue,
    maxLength
  });
  const getExceedValue = useCountExceed({
    countConfig,
    getTarget: () => inputRef.current
  });

  // ======================= Ref ========================
  useImperativeHandle(ref, () => ({
    focus,
    blur: () => {
      inputRef.current?.blur();
    },
    setSelectionRange: (start, end, direction) => {
      inputRef.current?.setSelectionRange(start, end, direction);
    },
    select: () => {
      inputRef.current?.select();
    },
    input: inputRef.current,
    nativeElement: holderRef.current?.nativeElement || inputRef.current
  }));
  useEffect(() => {
    if (keyLockRef.current) {
      keyLockRef.current = false;
    }
    setFocused(prev => prev && disabled ? false : prev);
  }, [disabled]);
  const triggerChange = (e, currentValue, info) => {
    const cutValue = getExceedValue(currentValue, compositionRef.current);
    if (info.source === 'compositionEnd' && currentValue === cutValue) {
      // Avoid triggering twice
      // https://github.com/ant-design/ant-design/issues/46587
      return;
    }
    setValue(cutValue);
    if (inputRef.current) {
      resolveOnChange(inputRef.current, e, onChange, cutValue);
    }
  };
  const onInternalChange = e => {
    triggerChange(e, e.target.value, {
      source: 'change'
    });
  };
  const onInternalCompositionEnd = e => {
    compositionRef.current = false;
    triggerChange(e, e.currentTarget.value, {
      source: 'compositionEnd'
    });
    onCompositionEnd?.(e);
  };
  const handleKeyDown = e => {
    if (onPressEnter && e.key === 'Enter' && !keyLockRef.current && !e.nativeEvent.isComposing) {
      keyLockRef.current = true;
      onPressEnter(e);
    }
    onKeyDown?.(e);
  };
  const handleKeyUp = e => {
    if (e.key === 'Enter') {
      keyLockRef.current = false;
    }
    onKeyUp?.(e);
  };
  const handleFocus = e => {
    setFocused(true);
    onFocus?.(e);
  };
  const handleBlur = e => {
    if (keyLockRef.current) {
      keyLockRef.current = false;
    }
    setFocused(false);
    onBlur?.(e);
  };
  const handleReset = e => {
    setValue('');
    focus();
    if (inputRef.current) {
      resolveOnChange(inputRef.current, e, onChange);
    }
  };

  // ====================== Input =======================
  const outOfRangeCls = isOutOfRange && `${prefixCls}-out-of-range`;
  const getInputElement = () => {
    // Fix https://fb.me/react-unknown-prop
    const otherProps = omit(props, ['prefixCls', 'onPressEnter', 'addonBefore', 'addonAfter', 'prefix', 'suffix', 'allowClear',
    // Input elements must be either controlled or uncontrolled,
    // specify either the value prop, or the defaultValue prop, but not both.
    'defaultValue', 'showCount', 'count', 'classes', 'htmlSize', 'styles', 'classNames', 'onClear']);
    return /*#__PURE__*/React.createElement("input", _extends({
      autoComplete: autoComplete
    }, otherProps, {
      onChange: onInternalChange,
      onFocus: handleFocus,
      onBlur: handleBlur,
      onKeyDown: handleKeyDown,
      onKeyUp: handleKeyUp,
      className: clsx(prefixCls, {
        [`${prefixCls}-disabled`]: disabled
      }, classNames?.input),
      style: styles?.input,
      ref: inputRef,
      size: htmlSize,
      type: type,
      onCompositionStart: e => {
        compositionRef.current = true;
        onCompositionStart?.(e);
      },
      onCompositionEnd: onInternalCompositionEnd
    }));
  };
  const getSuffix = () => {
    // Max length value
    if (suffix || countConfig.show) {
      return /*#__PURE__*/React.createElement(React.Fragment, null, countConfig.show && /*#__PURE__*/React.createElement("span", {
        className: clsx(`${prefixCls}-show-count-suffix`, {
          [`${prefixCls}-show-count-has-suffix`]: !!suffix
        }, classNames?.count),
        style: {
          ...styles?.count
        }
      }, dataCount), suffix);
    }
    return null;
  };

  // ====================== Render ======================
  return /*#__PURE__*/React.createElement(BaseInput, _extends({}, rest, {
    prefixCls: prefixCls,
    className: clsx(className, outOfRangeCls),
    handleReset: handleReset,
    value: formatValue,
    focused: focused,
    triggerFocus: focus,
    suffix: getSuffix(),
    disabled: disabled,
    classes: classes,
    classNames: classNames,
    styles: styles,
    ref: holderRef
  }), getInputElement());
});
export default Input;