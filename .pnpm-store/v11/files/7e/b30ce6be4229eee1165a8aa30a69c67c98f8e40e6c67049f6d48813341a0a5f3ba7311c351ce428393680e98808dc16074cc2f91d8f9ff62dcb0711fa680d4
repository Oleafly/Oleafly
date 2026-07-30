"use strict";

var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useRafDebounce;
var _react = _interopRequireDefault(require("react"));
var _util = require("@rc-component/util");
/**
 * Callback will only execute last one for each raf
 */
function useRafDebounce(callback) {
  const executeRef = _react.default.useRef(false);
  const rafRef = _react.default.useRef(null);
  const wrapperCallback = (0, _util.useEvent)(callback);
  return () => {
    if (executeRef.current) {
      return;
    }
    executeRef.current = true;
    wrapperCallback();
    rafRef.current = (0, _util.raf)(() => {
      executeRef.current = false;
    });
  };
}