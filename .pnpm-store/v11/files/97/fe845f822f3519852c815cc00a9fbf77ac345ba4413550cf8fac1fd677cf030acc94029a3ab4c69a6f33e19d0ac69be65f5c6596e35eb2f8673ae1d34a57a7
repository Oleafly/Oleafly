"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useNoticeTimer;
var React = _interopRequireWildcard(require("react"));
var _util = require("@rc-component/util");
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
/**
 * Runs the notice auto-close timer and reports progress updates.
 * Returns controls to pause and resume the timer.
 */
function useNoticeTimer(duration, onClose, onUpdate) {
  const mergedDuration = typeof duration === 'number' ? duration : 0;
  const durationMs = Math.max(mergedDuration, 0) * 1000;
  const onEventClose = (0, _util.useEvent)(onClose);
  const onEventUpdate = (0, _util.useEvent)(onUpdate);
  const [walking, setWalking] = React.useState(durationMs > 0);
  const passTimeRef = React.useRef(0);
  const lastRafTimeRef = React.useRef(null);
  function syncPassTime() {
    const now = Date.now();
    const lastRafTime = lastRafTimeRef.current;
    if (lastRafTime !== null) {
      passTimeRef.current += now - lastRafTime;
    }
    lastRafTimeRef.current = now;
  }
  const onPause = React.useCallback(() => {
    syncPassTime();
    setWalking(false);
  }, []);
  const onResume = React.useCallback(() => {
    if (durationMs > 0) {
      lastRafTimeRef.current = Date.now();
      setWalking(true);
    } else {
      onEventUpdate(0);
    }
  }, [durationMs]);

  // Reset when durationMs changed.
  React.useEffect(() => {
    passTimeRef.current = 0;
    setWalking(durationMs > 0);
  }, [durationMs]);

  // Trigger update when walking changed.
  React.useEffect(() => {
    if (!walking) {
      return;
    }
    let rafId = null;
    function step() {
      syncPassTime();
      if (passTimeRef.current >= durationMs) {
        onEventUpdate(1);
        onEventClose();
      } else {
        onEventUpdate(Math.min(passTimeRef.current / durationMs, 1));
        rafId = (0, _util.raf)(step);
      }
    }
    step();
    return () => {
      _util.raf.cancel(rafId);
    };
  }, [durationMs, walking]);
  return [onResume, onPause];
}