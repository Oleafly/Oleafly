"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useDelayState;
var _util = require("@rc-component/util");
var _react = _interopRequireDefault(require("react"));
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
/**
 * Will be `true` immediately for next effect.
 * But will be `false` for a delay of effect.
 */
function useDelayState(value, defaultValue, onChange) {
  const [state, setState] = (0, _util.useControlledState)(defaultValue, value);

  // Need force update to ensure React re-render
  const [, forceUpdate] = _react.default.useState({});
  const triggerUpdate = (0, _util.useEvent)(nextState => {
    setState(nextState);
    forceUpdate({});
  });
  const nextValueRef = _react.default.useRef(value);

  // ============================= Update =============================
  const rafRef = _react.default.useRef();
  const cancelRaf = () => {
    _util.raf.cancel(rafRef.current);
  };
  const doUpdate = (0, _util.useEvent)(() => {
    triggerUpdate(nextValueRef.current);
    if (onChange && state !== nextValueRef.current) {
      onChange(nextValueRef.current);
    }
  });
  const updateValue = (0, _util.useEvent)((next, immediately) => {
    cancelRaf();
    nextValueRef.current = next;
    if (next || immediately) {
      doUpdate();
    } else {
      rafRef.current = (0, _util.raf)(doUpdate);
    }
  });
  _react.default.useEffect(() => cancelRaf, []);
  return [state, updateValue];
}