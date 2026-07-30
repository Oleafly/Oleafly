"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useFieldFormat = useFieldFormat;
var React = _interopRequireWildcard(require("react"));
var _miscUtil = require("../../utils/miscUtil");
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function useFieldFormat(picker, locale, format) {
  return React.useMemo(() => {
    const rawFormat = (0, _miscUtil.getRowFormat)(picker, locale, format);
    const formatList = (0, _miscUtil.toArray)(rawFormat);
    const firstFormat = formatList[0];
    const maskFormat = typeof firstFormat === 'object' && firstFormat.type === 'mask' ? firstFormat.format : null;
    return [
    // Format list
    formatList.map(config => typeof config === 'string' || typeof config === 'function' ? config : config.format),
    // Mask Format
    maskFormat];
  }, [picker, locale, format]);
}