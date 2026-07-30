"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useCellRender;
var _util = require("@rc-component/util");
var React = _interopRequireWildcard(require("react"));
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function useCellRender(cellRender, dateRender, monthCellRender, range) {
  // ========================= Warn =========================
  if (process.env.NODE_ENV !== 'production') {
    (0, _util.warning)(!dateRender, `'dateRender' is deprecated. Please use 'cellRender' instead.`);
    (0, _util.warning)(!monthCellRender, `'monthCellRender' is deprecated. Please use 'cellRender' instead.`);
  }

  // ======================== Render ========================
  // Merged render
  const mergedCellRender = React.useMemo(() => {
    if (cellRender) {
      return cellRender;
    }
    return (current, info) => {
      const date = current;
      if (dateRender && info.type === 'date') {
        return dateRender(date, info.today);
      }
      if (monthCellRender && info.type === 'month') {
        return monthCellRender(date, info.locale);
      }
      return info.originNode;
    };
  }, [cellRender, monthCellRender, dateRender]);

  // Cell render
  const onInternalCellRender = React.useCallback((date, info) => mergedCellRender(date, {
    ...info,
    range
  }), [mergedCellRender, range]);
  return onInternalCellRender;
}