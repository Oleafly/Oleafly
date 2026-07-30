"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = usePresets;
var React = _interopRequireWildcard(require("react"));
var _util = require("@rc-component/util");
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function usePresets(presets, legacyRanges) {
  return React.useMemo(() => {
    if (presets) {
      return presets;
    }
    if (legacyRanges) {
      (0, _util.warning)(false, '`ranges` is deprecated. Please use `presets` instead.');
      return Object.entries(legacyRanges).map(([label, value]) => ({
        label,
        value
      }));
    }
    return [];
  }, [presets, legacyRanges]);
}