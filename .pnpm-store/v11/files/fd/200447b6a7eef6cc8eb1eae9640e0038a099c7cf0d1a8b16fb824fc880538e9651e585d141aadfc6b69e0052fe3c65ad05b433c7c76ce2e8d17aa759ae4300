"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useCountExceed;
var React = _interopRequireWildcard(require("react"));
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function useCountExceed({
  countConfig,
  getTarget
}) {
  const [selection, setSelection] = React.useState(null);
  const getTargetRef = React.useRef(getTarget);
  React.useEffect(() => {
    getTargetRef.current = getTarget;
  }, [getTarget]);
  React.useEffect(() => {
    if (selection) {
      getTargetRef.current()?.setSelectionRange(...selection);
      setSelection(null);
    }
  }, [selection]);
  const getExceedValue = React.useCallback((currentValue, isComposing) => {
    let nextValue = currentValue;
    if (!isComposing && countConfig.exceedFormatter && countConfig.max && countConfig.strategy(currentValue) > countConfig.max) {
      nextValue = countConfig.exceedFormatter(currentValue, {
        max: countConfig.max
      });
      if (currentValue !== nextValue) {
        setSelection([getTargetRef.current()?.selectionStart || 0, getTargetRef.current()?.selectionEnd || 0]);
      }
    }
    return nextValue;
  }, [countConfig]);
  return getExceedValue;
}