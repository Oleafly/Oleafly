function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
import * as React from 'react';
import PickerContext from "../context";
import { clsx } from 'clsx';
export default function Icon({
  icon,
  ...restProps
}) {
  const {
    prefixCls,
    classNames,
    styles
  } = React.useContext(PickerContext);
  return icon ? /*#__PURE__*/React.createElement("span", _extends({
    className: clsx(`${prefixCls}-suffix`, classNames.suffix),
    style: styles.suffix
  }, restProps), icon) : null;
}