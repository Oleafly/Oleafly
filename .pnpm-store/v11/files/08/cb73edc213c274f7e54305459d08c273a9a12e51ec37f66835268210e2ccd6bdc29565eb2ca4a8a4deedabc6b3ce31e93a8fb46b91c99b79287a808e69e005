"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useFixedInfo;
var _util = require("@rc-component/util");
var _fixUtil = require("../utils/fixUtil");
var React = _interopRequireWildcard(require("react"));
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function useFixedInfo(flattenColumns, stickyOffsets) {
  const fixedInfoList = React.useMemo(() => flattenColumns.map((_, colIndex) => (0, _fixUtil.getCellFixedInfo)(colIndex, colIndex, flattenColumns, stickyOffsets)), [flattenColumns, stickyOffsets]);
  return (0, _util.useMemo)(() => fixedInfoList, [fixedInfoList], (prev, next) => !(0, _util.isEqual)(prev, next));
}