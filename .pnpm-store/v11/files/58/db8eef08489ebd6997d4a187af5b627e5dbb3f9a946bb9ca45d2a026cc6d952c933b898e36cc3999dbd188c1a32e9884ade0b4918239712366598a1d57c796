"use client";

import * as React from 'react';
import Tooltip from '../../tooltip';
const EllipsisTooltip = ({
  enableEllipsis,
  isEllipsis,
  open,
  children,
  tooltipProps
}) => {
  if (!tooltipProps?.title || !enableEllipsis) {
    return children;
  }
  const mergedOpen = open && isEllipsis;
  return /*#__PURE__*/React.createElement(Tooltip, {
    open: mergedOpen,
    ...tooltipProps
  }, children);
};
if (process.env.NODE_ENV !== 'production') {
  EllipsisTooltip.displayName = 'EllipsisTooltip';
}
export default EllipsisTooltip;