"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useDiffItem;
var React = _interopRequireWildcard(require("react"));
var _algorithmUtil = require("../utils/algorithmUtil");
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function useDiffItem(data, getKey, onDiff) {
  const [prevData, setPrevData] = React.useState(data);
  const [diffItem, setDiffItem] = React.useState(null);
  React.useEffect(() => {
    const diff = (0, _algorithmUtil.findListDiffIndex)(prevData || [], data || [], getKey);
    if (diff?.index !== undefined) {
      onDiff?.(diff.index);
      setDiffItem(data[diff.index]);
    }
    setPrevData(data);
  }, [data]);
  return [diffItem];
}