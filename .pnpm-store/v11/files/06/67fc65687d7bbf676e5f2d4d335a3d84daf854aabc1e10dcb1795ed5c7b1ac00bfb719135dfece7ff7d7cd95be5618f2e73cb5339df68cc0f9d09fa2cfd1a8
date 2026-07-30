"use strict";

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useFrameState;
var React = _interopRequireWildcard(require("react"));
var _util = require("@rc-component/util");
function useFrameState(defaultValue) {
  const [value, setValue] = React.useState(defaultValue);
  const frameRef = React.useRef(null);
  const batchRef = React.useRef([]);
  const destroyRef = React.useRef(false);
  React.useEffect(() => {
    destroyRef.current = false;
    return () => {
      destroyRef.current = true;
      _util.raf.cancel(frameRef.current);
      frameRef.current = null;
    };
  }, []);
  function setFrameValue(updater) {
    if (destroyRef.current) {
      return;
    }
    if (frameRef.current === null) {
      batchRef.current = [];
      frameRef.current = (0, _util.raf)(() => {
        frameRef.current = null;
        setValue(prevValue => {
          let current = prevValue;
          batchRef.current.forEach(func => {
            current = func(current);
          });
          return current;
        });
      });
    }
    batchRef.current.push(updater);
  }
  return [value, setFrameValue];
}