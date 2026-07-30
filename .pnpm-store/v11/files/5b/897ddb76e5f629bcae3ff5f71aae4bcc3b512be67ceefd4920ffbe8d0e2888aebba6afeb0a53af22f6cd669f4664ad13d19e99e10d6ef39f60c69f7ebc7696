"use client";

import * as React from 'react';
import { clsx } from 'clsx';
import { useTypographySemantic } from './hooks/useTypographySemantic';
import useStyle from './style';
const InternalTypography = /*#__PURE__*/React.forwardRef((props, ref) => {
  const {
    component: Component = 'article',
    className,
    rootClassName,
    children,
    direction,
    style,
    classNames,
    styles,
    prefixCls,
    ...restProps
  } = props;
  const [hashId, cssVarCls] = useStyle(prefixCls);
  const componentClassName = clsx(prefixCls, {
    [`${prefixCls}-rtl`]: direction === 'rtl'
  }, className, rootClassName, hashId, cssVarCls, classNames?.root);
  const mergedStyle = {
    ...styles?.root,
    ...style
  };
  return /*#__PURE__*/React.createElement(Component, {
    ...restProps,
    className: componentClassName,
    style: mergedStyle,
    ref: ref
  }, children);
});
if (process.env.NODE_ENV !== 'production') {
  InternalTypography.displayName = 'InternalTypography';
}
const Typography = /*#__PURE__*/React.forwardRef((props, ref) => {
  const {
    prefixCls: customizePrefixCls,
    className,
    rootClassName,
    direction: typographyDirection,
    classNames,
    styles,
    ...restProps
  } = props;
  const [mergedClassNames, mergedStyles, mergedPrefixCls, mergedDirection] = useTypographySemantic(customizePrefixCls, classNames, styles, typographyDirection, props);
  return /*#__PURE__*/React.createElement(InternalTypography, {
    ref: ref,
    className: clsx(className, rootClassName),
    direction: mergedDirection,
    classNames: mergedClassNames,
    styles: mergedStyles,
    prefixCls: mergedPrefixCls,
    ...restProps
  });
});
if (process.env.NODE_ENV !== 'production') {
  Typography.displayName = 'Typography';
}
export default Typography;
export { InternalTypography };