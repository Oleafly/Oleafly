"use strict";

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = scrollTo;
var _util = require("@rc-component/util");
var _easings = require("./easings");
var _getScroll = _interopRequireWildcard(require("./getScroll"));
var _is = require("./is");
function scrollTo(y, options = {}) {
  const {
    getContainer = () => window,
    callback,
    duration = 450
  } = options;
  const container = getContainer();
  const scrollTop = (0, _getScroll.default)(container);
  const startTime = Date.now();
  let rafId;
  const frameFunc = () => {
    const timestamp = Date.now();
    const time = timestamp - startTime;
    const nextScrollTop = (0, _easings.easeInOutCubic)(time > duration ? duration : time, scrollTop, y, duration);
    if ((0, _getScroll.isWindow)(container)) {
      container.scrollTo(window.pageXOffset, nextScrollTop);
    } else if ((0, _getScroll.isDocument)(container)) {
      container.documentElement.scrollTop = nextScrollTop;
    } else {
      container.scrollTop = nextScrollTop;
    }
    if (time < duration) {
      rafId = (0, _util.raf)(frameFunc);
    } else if ((0, _is.isFunction)(callback)) {
      callback();
    }
  };
  rafId = (0, _util.raf)(frameFunc);
  return () => {
    _util.raf.cancel(rafId);
  };
}