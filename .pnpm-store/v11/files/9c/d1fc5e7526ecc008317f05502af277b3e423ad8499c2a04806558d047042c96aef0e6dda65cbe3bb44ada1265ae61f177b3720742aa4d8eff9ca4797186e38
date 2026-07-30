function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
import * as React from 'react';
import PickerContext from "../context";
import { clsx } from 'clsx';
export default function ClearIcon({
  icon,
  onClear,
  ...restProps
}) {
  const {
    prefixCls,
    classNames,
    styles,
    locale
  } = React.useContext(PickerContext);
  return /*#__PURE__*/React.createElement("button", _extends({}, restProps, {
    type: "button",
    "aria-label": locale.clear,
    className: clsx(`${prefixCls}-clear`, classNames.suffix),
    style: styles.suffix,
    onMouseDown: e => {
      e.preventDefault();
    },
    onClick: e => {
      e.stopPropagation();
      onClear();
    }
  }), icon);
}