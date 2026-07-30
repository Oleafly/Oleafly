"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useClosable;
var _util = require("@rc-component/util");
var React = _interopRequireWildcard(require("react"));
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
/**
 * Normalizes the closable option into a boolean flag, config, and aria props.
 */
function useClosable(closable) {
  // Convert boolean shorthand into the object shape used by render logic.
  const closableObj = React.useMemo(() => {
    if (closable === false) {
      return {
        closeIcon: null,
        disabled: true
      };
    }
    if (typeof closable === 'object' && closable !== null) {
      return closable;
    }
    return {};
  }, [closable]);

  // Fill defaults so callers can read closeIcon and disabled without extra guards.
  const closableConfig = React.useMemo(() => ({
    ...closableObj,
    closeIcon: 'closeIcon' in closableObj ? closableObj.closeIcon : '×',
    disabled: closableObj.disabled ?? false
  }), [closableObj]);

  // Forward aria-* props from the closable config to the close button.
  const closableAriaProps = React.useMemo(() => (0, _util.pickAttrs)(closableConfig, true), [closableConfig]);
  return [!!closable, closableConfig, closableAriaProps];
}