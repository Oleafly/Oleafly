"use strict";

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useRafLock;
var React = _interopRequireWildcard(require("react"));
var _util = require("@rc-component/util");
function useRafLock() {
  const [state, setState] = React.useState(false);
  const rafRef = React.useRef(null);
  const cleanup = () => {
    _util.raf.cancel(rafRef.current);
  };
  const setDelayState = nextState => {
    cleanup();
    if (nextState) {
      setState(nextState);
    } else {
      rafRef.current = (0, _util.raf)(() => {
        setState(nextState);
      });
    }
  };
  React.useEffect(() => cleanup, []);
  return [state, setDelayState];
}