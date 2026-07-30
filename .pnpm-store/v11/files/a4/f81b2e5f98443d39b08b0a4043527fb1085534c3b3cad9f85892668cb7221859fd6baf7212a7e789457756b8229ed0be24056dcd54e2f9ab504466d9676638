import { unit } from '@ant-design/cssinjs';
import { isNonNullable } from '../_util/is';
export function getPlacementOffsetStyle(top, bottom) {
  return {
    ...(isNonNullable(top) && {
      '--notification-top': unit(top)
    }),
    ...(isNonNullable(bottom) && {
      '--notification-bottom': unit(bottom)
    })
  };
}
export function getMotion(prefixCls) {
  return {
    motionName: `${prefixCls}-fade`
  };
}
export function getCloseIconConfig(closeIcon, notificationConfig, notification) {
  if (typeof closeIcon !== 'undefined') {
    return closeIcon;
  }
  if (typeof notificationConfig?.closeIcon !== 'undefined') {
    return notificationConfig.closeIcon;
  }
  return notification?.closeIcon;
}