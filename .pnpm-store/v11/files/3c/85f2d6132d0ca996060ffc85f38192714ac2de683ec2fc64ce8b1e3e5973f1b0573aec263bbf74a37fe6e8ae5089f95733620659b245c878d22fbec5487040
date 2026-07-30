"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useAnimateConfig;
var _is = require("../../_util/is");
var _motion = require("../../_util/motion");
const motion = {
  motionAppear: false,
  motionEnter: true,
  motionLeave: true
};
function useAnimateConfig(prefixCls, animated = {
  inkBar: true,
  tabPane: false
}) {
  let mergedAnimated;
  if (animated === false) {
    mergedAnimated = {
      inkBar: false,
      tabPane: false
    };
  } else if (animated === true) {
    mergedAnimated = {
      inkBar: true,
      tabPane: true
    };
  } else {
    mergedAnimated = {
      inkBar: true,
      ...((0, _is.isPlainObject)(animated) ? animated : {})
    };
  }
  if (mergedAnimated.tabPane) {
    mergedAnimated.tabPaneMotion = {
      ...motion,
      motionName: (0, _motion.getTransitionName)(prefixCls, 'switch')
    };
  }
  return mergedAnimated;
}