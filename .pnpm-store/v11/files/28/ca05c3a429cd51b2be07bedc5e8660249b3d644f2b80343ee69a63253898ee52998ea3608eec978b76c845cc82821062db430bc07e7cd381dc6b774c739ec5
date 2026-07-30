"use client";

import React, { forwardRef } from 'react';
import { clsx } from 'clsx';
export const InternalPanel = /*#__PURE__*/forwardRef((props, ref) => {
  const {
    prefixCls,
    className,
    children,
    destroyOnHidden = false,
    size,
    style,
    supportMotion
  } = props;
  const isCollapsed = size === 0 || typeof size === 'string' && Number.parseFloat(size) === 0;
  const panelClassName = clsx(`${prefixCls}-panel`, {
    [`${prefixCls}-panel-hidden`]: isCollapsed,
    [`${prefixCls}-panel-transition`]: supportMotion
  }, className);
  const hasSize = size !== undefined;
  return /*#__PURE__*/React.createElement("div", {
    ref: ref,
    className: panelClassName,
    style: {
      ...style,
      // Use auto when start from ssr
      flexBasis: hasSize ? size : 'auto',
      flexGrow: hasSize ? 0 : 1
    }
  }, !(destroyOnHidden && isCollapsed) && children);
});
if (process.env.NODE_ENV !== 'production') {
  InternalPanel.displayName = 'Panel';
}
const Panel = () => null;
export default Panel;