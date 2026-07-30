"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getTransitionName = exports.default = void 0;
var _configProvider = require("../config-provider");
var _is = require("./is");
// ================== Collapse Motion ==================
const getCollapsedHeight = () => ({
  height: 0,
  opacity: 0
});
const getRealHeight = node => ({
  height: node?.scrollHeight ?? 0,
  opacity: node ? 1 : 0
});
const getCurrentHeight = node => ({
  height: node?.offsetHeight ?? 0
});
const skipOpacityTransition = (_, event) => {
  return event?.deadline === true || (0, _is.isTransitionEvent)(event) && event.propertyName === 'height';
};
const initCollapseMotion = (rootCls = _configProvider.defaultPrefixCls) => ({
  motionName: `${rootCls}-motion-collapse`,
  onAppearStart: getCollapsedHeight,
  onEnterStart: getCollapsedHeight,
  onAppearActive: getRealHeight,
  onEnterActive: getRealHeight,
  onLeaveStart: getCurrentHeight,
  onLeaveActive: getCollapsedHeight,
  onAppearEnd: skipOpacityTransition,
  onEnterEnd: skipOpacityTransition,
  onLeaveEnd: skipOpacityTransition,
  motionDeadline: 500
});
const _SelectPlacements = ['bottomLeft', 'bottomRight', 'topLeft', 'topRight'];
const getTransitionName = (rootPrefixCls, motion, transitionName) => {
  if (transitionName !== undefined) {
    return transitionName;
  }
  return `${rootPrefixCls}-${motion}`;
};
exports.getTransitionName = getTransitionName;
var _default = exports.default = initCollapseMotion;