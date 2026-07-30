"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useDelayState;
var React = _interopRequireWildcard(require("react"));
var _raf = _interopRequireDefault(require("../raf"));
var _useEvent = _interopRequireDefault(require("./useEvent"));
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
/**
 * Similar to `useState`, but updates on the next frame by default.
 * Pending updates are always replaced by the latest one.
 */
function useDelayState(defaultValue) {
  const [value, setValue] = React.useState(defaultValue);
  const delayRef = React.useRef(null);
  const cancelPending = (0, _useEvent.default)(() => {
    if (delayRef.current) {
      const [isRaf, delay] = delayRef.current;
      if (isRaf) {
        _raf.default.cancel(delay);
      } else {
        clearTimeout(delay);
      }
      delayRef.current = null;
    }
  });
  const setDelayValue = (0, _useEvent.default)((nextValue, immediatelyOrDelay) => {
    const delayConfig = immediatelyOrDelay || {
      frame: 1
    };
    cancelPending();
    if (delayConfig === true) {
      setValue(nextValue);
    } else if ('ms' in delayConfig) {
      delayRef.current = [false, setTimeout(() => setValue(nextValue), delayConfig.ms)];
    } else {
      delayRef.current = [true, (0, _raf.default)(() => setValue(nextValue), delayConfig.frame)];
    }
  });
  return [value, setDelayValue];
}