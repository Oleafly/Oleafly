"use client";

import React from 'react';
import { clsx } from 'clsx';
import { generateColor } from '../util';
const ColorClear = ({
  prefixCls,
  value,
  onChange,
  className,
  style
}) => {
  const onClick = () => {
    if (onChange && value && !value.cleared) {
      const hsba = value.toHsb();
      hsba.a = 0;
      const genColor = generateColor(hsba);
      genColor.cleared = true;
      onChange(genColor);
    }
  };
  const onKeyDown = event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  };
  return /*#__PURE__*/React.createElement("div", {
    role: "button",
    "aria-label": "Clear color",
    tabIndex: 0,
    className: clsx(`${prefixCls}-clear`, className),
    style: style,
    onClick: onClick,
    onKeyDown: onKeyDown
  });
};
export default ColorClear;