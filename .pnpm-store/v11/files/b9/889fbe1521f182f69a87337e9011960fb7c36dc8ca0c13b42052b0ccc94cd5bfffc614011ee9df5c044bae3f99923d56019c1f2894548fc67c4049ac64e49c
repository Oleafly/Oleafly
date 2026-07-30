"use client";

import * as React from 'react';
import EnterOutlined from "@ant-design/icons/es/icons/EnterOutlined";
import { KeyCode } from '@rc-component/util';
import { clsx } from 'clsx';
import { cloneElement } from '../_util/reactNode';
import TextArea from '../input/TextArea';
import useStyle from './style';
const Editable = props => {
  const {
    prefixCls,
    'aria-label': ariaLabel,
    className,
    style,
    classNames,
    styles,
    direction,
    maxLength,
    autoSize = true,
    value,
    onSave,
    onCancel,
    onEnd,
    component,
    enterIcon = /*#__PURE__*/React.createElement(EnterOutlined, null)
  } = props;
  const ref = React.useRef(null);
  const inCompositionRef = React.useRef(false);
  const lastKeyCodeRef = React.useRef(null);
  const [current, setCurrent] = React.useState(value);
  React.useEffect(() => {
    setCurrent(value);
  }, [value]);
  React.useEffect(() => {
    if (ref.current?.resizableTextArea) {
      const {
        textArea
      } = ref.current.resizableTextArea;
      textArea.focus();
      const {
        length
      } = textArea.value;
      textArea.setSelectionRange(length, length);
    }
  }, []);
  const onChange = ({
    target
  }) => {
    setCurrent(target.value.replace(/[\n\r]/g, ''));
  };
  const onCompositionStart = () => {
    inCompositionRef.current = true;
  };
  const onCompositionEnd = () => {
    inCompositionRef.current = false;
  };
  const onKeyDown = ({
    keyCode
  }) => {
    // We don't record keyCode when IME is using
    if (inCompositionRef.current) {
      return;
    }
    lastKeyCodeRef.current = keyCode;
  };
  const confirmChange = () => {
    onSave(current.trim());
  };
  const onKeyUp = ({
    keyCode,
    ctrlKey,
    altKey,
    metaKey,
    shiftKey
  }) => {
    // Check if it's a real key
    if (lastKeyCodeRef.current !== keyCode || inCompositionRef.current || ctrlKey || altKey || metaKey || shiftKey) {
      return;
    }
    if (keyCode === KeyCode.ENTER) {
      confirmChange();
      onEnd?.();
    } else if (keyCode === KeyCode.ESC) {
      onCancel();
    }
  };
  const onBlur = () => {
    confirmChange();
  };
  const [hashId, cssVarCls] = useStyle(prefixCls);
  const textAreaClassName = clsx(prefixCls, `${prefixCls}-edit-content`, {
    [`${prefixCls}-rtl`]: direction === 'rtl',
    [`${prefixCls}-${component}`]: !!component
  }, className, classNames.root, hashId, cssVarCls);
  return /*#__PURE__*/React.createElement("div", {
    className: textAreaClassName,
    style: {
      ...styles.root,
      ...style
    }
  }, /*#__PURE__*/React.createElement(TextArea, {
    ref: ref,
    maxLength: maxLength,
    value: current,
    onChange: onChange,
    onKeyDown: onKeyDown,
    onKeyUp: onKeyUp,
    onCompositionStart: onCompositionStart,
    onCompositionEnd: onCompositionEnd,
    onBlur: onBlur,
    "aria-label": ariaLabel,
    rows: 1,
    autoSize: autoSize,
    className: classNames.textarea,
    style: styles.textarea
  }), enterIcon !== null ? cloneElement(enterIcon, {
    className: `${prefixCls}-edit-content-confirm`
  }) : null);
};
export default Editable;