function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
import { clsx } from 'clsx';
import KeyCode from "@rc-component/util/es/KeyCode";
import * as React from 'react';
import SliderContext from "../context";
import { getDirectionStyle, getIndex } from "../util";
const Handle = /*#__PURE__*/React.forwardRef((props, ref) => {
  const {
    prefixCls,
    value,
    valueIndex,
    onStartMove,
    onDelete,
    style,
    render,
    dragging,
    draggingDelete,
    onOffsetChange,
    onChangeComplete,
    onFocus,
    onMouseEnter,
    ...restProps
  } = props;
  const {
    min,
    max,
    direction,
    keyboard,
    range,
    tabIndex,
    ariaLabelForHandle,
    ariaLabelledByForHandle,
    ariaRequired,
    ariaValueTextFormatterForHandle,
    styles,
    classNames,
    isHandleDisabled
  } = React.useContext(SliderContext);
  const mergedDisabled = isHandleDisabled(valueIndex);
  const handlePrefixCls = `${prefixCls}-handle`;

  // ============================ Events ============================
  const onInternalStartMove = e => {
    if (mergedDisabled) {
      e.stopPropagation();
      return;
    }
    onStartMove(e, valueIndex);
  };
  const onInternalFocus = e => {
    onFocus?.(e, valueIndex);
  };
  const onInternalMouseEnter = e => {
    onMouseEnter(e, valueIndex);
  };

  // =========================== Keyboard ===========================
  const onKeyDown = e => {
    if (!mergedDisabled && keyboard) {
      let offset;

      // Change the value
      switch (e.which || e.keyCode) {
        case KeyCode.LEFT:
          offset = direction === 'ltr' || direction === 'btt' ? -1 : 1;
          break;
        case KeyCode.RIGHT:
          offset = direction === 'ltr' || direction === 'btt' ? 1 : -1;
          break;

        // Up is plus
        case KeyCode.UP:
          offset = direction !== 'ttb' ? 1 : -1;
          break;

        // Down is minus
        case KeyCode.DOWN:
          offset = direction !== 'ttb' ? -1 : 1;
          break;
        case KeyCode.HOME:
          offset = 'min';
          break;
        case KeyCode.END:
          offset = 'max';
          break;
        case KeyCode.PAGE_UP:
          offset = 2;
          break;
        case KeyCode.PAGE_DOWN:
          offset = -2;
          break;
        case KeyCode.BACKSPACE:
        case KeyCode.DELETE:
          onDelete?.(valueIndex);
          break;
      }
      if (offset !== undefined) {
        e.preventDefault();
        onOffsetChange(offset, valueIndex);
      }
    }
  };
  const handleKeyUp = e => {
    switch (e.which || e.keyCode) {
      case KeyCode.LEFT:
      case KeyCode.RIGHT:
      case KeyCode.UP:
      case KeyCode.DOWN:
      case KeyCode.HOME:
      case KeyCode.END:
      case KeyCode.PAGE_UP:
      case KeyCode.PAGE_DOWN:
        onChangeComplete?.();
        break;
    }
  };

  // ============================ Offset ============================
  const positionStyle = getDirectionStyle(direction, value, min, max);

  // ============================ Render ============================
  let divProps = {};
  if (valueIndex !== null) {
    divProps = {
      tabIndex: mergedDisabled ? undefined : getIndex(tabIndex, valueIndex) ?? undefined,
      role: 'slider',
      'aria-valuemin': min,
      'aria-valuemax': max,
      'aria-valuenow': value,
      'aria-disabled': mergedDisabled,
      'aria-label': getIndex(ariaLabelForHandle, valueIndex),
      'aria-labelledby': getIndex(ariaLabelledByForHandle, valueIndex),
      'aria-required': getIndex(ariaRequired, valueIndex),
      'aria-valuetext': getIndex(ariaValueTextFormatterForHandle, valueIndex)?.(value),
      'aria-orientation': direction === 'ltr' || direction === 'rtl' ? 'horizontal' : 'vertical',
      onMouseDown: onInternalStartMove,
      onTouchStart: onInternalStartMove,
      onFocus: onInternalFocus,
      onMouseEnter: onInternalMouseEnter,
      onKeyDown,
      onKeyUp: handleKeyUp
    };
  }
  let handleNode = /*#__PURE__*/React.createElement("div", _extends({
    ref: ref,
    className: clsx(handlePrefixCls, {
      [`${handlePrefixCls}-${valueIndex + 1}`]: valueIndex !== null && range,
      [`${handlePrefixCls}-dragging`]: dragging,
      [`${handlePrefixCls}-dragging-delete`]: draggingDelete,
      [`${handlePrefixCls}-disabled`]: mergedDisabled
    }, classNames.handle),
    style: {
      ...positionStyle,
      ...style,
      ...styles.handle
    }
  }, divProps, restProps));

  // Customize
  if (render) {
    handleNode = render(handleNode, {
      index: valueIndex,
      prefixCls,
      value,
      dragging,
      draggingDelete
    });
  }
  return handleNode;
});
if (process.env.NODE_ENV !== 'production') {
  Handle.displayName = 'Handle';
}
export default Handle;