"use strict";

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useDelay;
var React = _interopRequireWildcard(require("react"));
var _util = require("@rc-component/util");
function useDelay(callback) {
  const idRef = React.useRef(0);
  const clearRaf = () => {
    _util.raf.cancel(idRef.current);
  };
  React.useEffect(() => clearRaf, []);
  const triggerFn = (0, _util.useEvent)(() => {
    clearRaf();
    idRef.current = (0, _util.raf)(callback);
  });
  return triggerFn;
}