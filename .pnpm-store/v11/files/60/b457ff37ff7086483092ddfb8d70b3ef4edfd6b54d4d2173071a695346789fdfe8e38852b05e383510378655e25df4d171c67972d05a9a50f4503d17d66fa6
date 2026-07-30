function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
import { clsx } from 'clsx';
import React, { useEffect, useImperativeHandle, useRef } from 'react';
import BaseInput from "./BaseInput";
import useCount from "./hooks/useCount";
import useCountDisplay from "./hooks/useCountDisplay";
import useCountExceed from "./hooks/useCountExceed";
import useMergedValue from "./hooks/useMergedValue";
import ResizableTextArea from "./ResizableTextArea";
import { resolveOnChange } from "./utils/commonUtils";
const TextArea = /*#__PURE__*/React.forwardRef(({
  defaultValue,
  value: customValue,
  onFocus,
  onBlur,
  onChange,
  allowClear,
  maxLength,
  onCompositionStart,
  onCompositionEnd,
  suffix,
  prefixCls = 'rc-textarea',
  showCount,
  count,
  className,
  style,
  disabled,
  hidden,
  classNames,
  styles,
  onResize,
  onClear,
  onPressEnter,
  readOnly,
  autoSize,
  onKeyDown,
  ...rest
}, ref) => {
  const [focused, setFocused] = React.useState(false);
  const compositionRef = React.useRef(false);
  const [textareaResized, setTextareaResized] = React.useState(null);

  // =============================== Ref ================================
  const holderRef = useRef(null);
  const resizableTextAreaRef = useRef(null);
  const getTextArea = () => resizableTextAreaRef.current?.textArea || null;
  const {
    setValue,
    formatValue
  } = useMergedValue(defaultValue, customValue);
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
    getTarget: () => resizableTextAreaRef.current?.textArea || null
  });
  const focus = () => {
    getTextArea()?.focus();
  };
  useImperativeHandle(ref, () => ({
    resizableTextArea: resizableTextAreaRef.current,
    focus,
    blur: () => {
      getTextArea()?.blur();
    },
    nativeElement: holderRef.current?.nativeElement || getTextArea()
  }));
  useEffect(() => {
    setFocused(prev => !disabled && prev);
  }, [disabled]);

  // ============================== Count ===============================
  // ============================== Change ==============================
  const triggerChange = (e, currentValue) => {
    const cutValue = getExceedValue(currentValue, compositionRef.current);
    setValue(cutValue);
    resolveOnChange(e.currentTarget, e, onChange, cutValue);
  };

  // =========================== Value Update ===========================
  const onInternalCompositionStart = e => {
    compositionRef.current = true;
    onCompositionStart?.(e);
  };
  const onInternalCompositionEnd = e => {
    compositionRef.current = false;
    triggerChange(e, e.currentTarget.value);
    onCompositionEnd?.(e);
  };
  const onInternalChange = e => {
    triggerChange(e, e.target.value);
  };
  const handleKeyDown = e => {
    if (e.key === 'Enter' && onPressEnter && !e.nativeEvent.isComposing) {
      onPressEnter(e);
    }
    onKeyDown?.(e);
  };
  const handleFocus = e => {
    setFocused(true);
    onFocus?.(e);
  };
  const handleBlur = e => {
    setFocused(false);
    onBlur?.(e);
  };

  // ============================== Reset ===============================
  const handleReset = e => {
    setValue('');
    focus();
    const textarea = getTextArea();
    if (textarea) {
      resolveOnChange(textarea, e, onChange);
    }
  };
  let suffixNode = suffix;
  if (countConfig.show) {
    suffixNode = /*#__PURE__*/React.createElement(React.Fragment, null, suffixNode, /*#__PURE__*/React.createElement("span", {
      className: clsx(`${prefixCls}-data-count`, classNames?.count),
      style: styles?.count
    }, dataCount));
  }
  const handleResize = size => {
    onResize?.(size);
    if (getTextArea()?.style.height) {
      setTextareaResized(true);
    }
  };
  const isPureTextArea = !autoSize && !showCount && !allowClear;
  return /*#__PURE__*/React.createElement(BaseInput, {
    ref: holderRef,
    value: formatValue,
    allowClear: allowClear,
    handleReset: handleReset,
    suffix: suffixNode,
    prefixCls: prefixCls,
    classNames: {
      ...classNames,
      affixWrapper: clsx(classNames?.affixWrapper, {
        [`${prefixCls}-show-count`]: showCount,
        [`${prefixCls}-textarea-allow-clear`]: allowClear
      })
    },
    disabled: disabled,
    focused: focused,
    className: clsx(className, isOutOfRange && `${prefixCls}-out-of-range`),
    style: {
      ...style,
      ...(textareaResized && !isPureTextArea ? {
        height: 'auto'
      } : {})
    },
    dataAttrs: typeof dataCount === 'string' ? {
      affixWrapper: {
        'data-count': dataCount
      }
    } : undefined,
    styles: styles,
    hidden: hidden,
    readOnly: readOnly,
    onClear: onClear
  }, /*#__PURE__*/React.createElement(ResizableTextArea, _extends({}, rest, {
    autoSize: autoSize,
    maxLength: maxLength,
    onKeyDown: handleKeyDown,
    onChange: onInternalChange,
    onFocus: handleFocus,
    onBlur: handleBlur,
    onCompositionStart: onInternalCompositionStart,
    onCompositionEnd: onInternalCompositionEnd,
    className: clsx(classNames?.textarea),
    style: {
      resize: style?.resize,
      ...styles?.textarea
    },
    disabled: disabled,
    prefixCls: prefixCls,
    onResize: handleResize,
    ref: resizableTextAreaRef,
    readOnly: readOnly
  })));
});
export default TextArea;