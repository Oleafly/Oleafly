"use client";

import * as React from 'react';
import { clsx } from 'clsx';
import { isNumber } from '../_util/is';
import { devUseWarning } from '../_util/warning';
const Element = props => {
  const {
    prefixCls,
    className,
    style,
    size,
    shape
  } = props;
  if (process.env.NODE_ENV !== 'production') {
    const warning = devUseWarning('Skeleton');
    warning.deprecated(size !== 'default', 'size="default"', 'size="medium"');
  }
  const sizeCls = clsx({
    [`${prefixCls}-lg`]: size === 'large',
    [`${prefixCls}-sm`]: size === 'small'
  });
  const shapeCls = clsx({
    [`${prefixCls}-circle`]: shape === 'circle',
    [`${prefixCls}-square`]: shape === 'square',
    [`${prefixCls}-round`]: shape === 'round'
  });
  const sizeStyle = React.useMemo(() => isNumber(size) ? {
    width: size,
    height: size,
    lineHeight: `${size}px`
  } : {}, [size]);
  return /*#__PURE__*/React.createElement("span", {
    className: clsx(prefixCls, sizeCls, shapeCls, className),
    style: {
      ...sizeStyle,
      ...style
    }
  });
};
export default Element;