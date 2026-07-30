"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
var _toConsumableArray2 = _interopRequireDefault(require("@babel/runtime/helpers/toConsumableArray"));
var _util = require("@rc-component/util");
function throttleByAnimationFrame(fn) {
  let requestId = null;
  const later = args => () => {
    requestId = null;
    fn.apply(void 0, (0, _toConsumableArray2.default)(args));
  };
  const throttled = (...args) => {
    if (requestId === null) {
      requestId = (0, _util.raf)(later(args));
    }
  };
  throttled.cancel = () => {
    _util.raf.cancel(requestId);
    requestId = null;
  };
  return throttled;
}
var _default = exports.default = throttleByAnimationFrame;