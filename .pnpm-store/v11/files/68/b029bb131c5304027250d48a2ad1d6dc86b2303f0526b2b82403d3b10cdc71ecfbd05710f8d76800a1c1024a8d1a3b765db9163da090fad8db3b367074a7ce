"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getCloseIconConfig = getCloseIconConfig;
exports.getMotion = getMotion;
exports.getPlacementOffsetStyle = getPlacementOffsetStyle;
var _cssinjs = require("@ant-design/cssinjs");
var _is = require("../_util/is");
function getPlacementOffsetStyle(top, bottom) {
  return {
    ...((0, _is.isNonNullable)(top) && {
      '--notification-top': (0, _cssinjs.unit)(top)
    }),
    ...((0, _is.isNonNullable)(bottom) && {
      '--notification-bottom': (0, _cssinjs.unit)(bottom)
    })
  };
}
function getMotion(prefixCls) {
  return {
    motionName: `${prefixCls}-fade`
  };
}
function getCloseIconConfig(closeIcon, notificationConfig, notification) {
  if (typeof closeIcon !== 'undefined') {
    return closeIcon;
  }
  if (typeof notificationConfig?.closeIcon !== 'undefined') {
    return notificationConfig.closeIcon;
  }
  return notification?.closeIcon;
}