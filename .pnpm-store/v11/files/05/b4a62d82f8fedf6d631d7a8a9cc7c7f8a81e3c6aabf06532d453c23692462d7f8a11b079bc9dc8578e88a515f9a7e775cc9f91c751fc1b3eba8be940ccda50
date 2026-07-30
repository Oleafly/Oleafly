"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useChildren;
var React = _interopRequireWildcard(require("react"));
var _Item = require("../Item");
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function useChildren(list, startIndex, endIndex, scrollWidth, offsetX, setNodeRef, renderFunc, {
  getKey
}) {
  return list.slice(startIndex, endIndex + 1).map((item, index) => {
    const eleIndex = startIndex + index;
    const node = renderFunc(item, eleIndex, {
      style: {
        width: scrollWidth
      },
      offsetX
    });
    const key = getKey(item);
    return /*#__PURE__*/React.createElement(_Item.Item, {
      key: key,
      setRef: ele => setNodeRef(item, ele)
    }, node);
  });
}