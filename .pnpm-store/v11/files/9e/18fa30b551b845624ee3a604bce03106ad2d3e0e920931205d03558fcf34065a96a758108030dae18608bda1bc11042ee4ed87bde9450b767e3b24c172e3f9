"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useSyncState;
var React = _interopRequireWildcard(require("react"));
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
/**
 * Sync value with state.
 * This should only used for internal which not affect outside calculation.
 * Since it's not safe for suspense.
 */
function useSyncState(defaultValue, controlledValue) {
  const valueRef = React.useRef(defaultValue);
  const [, forceUpdate] = React.useState({});
  const getter = useControlledValueFirst => useControlledValueFirst && controlledValue !== undefined ? controlledValue : valueRef.current;
  const setter = nextValue => {
    valueRef.current = nextValue;
    forceUpdate({});
  };
  return [getter, setter, getter(true)];
}