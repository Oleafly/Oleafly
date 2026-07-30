"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useSizes;
var React = _interopRequireWildcard(require("react"));
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
/**
 * Stores measured node sizes by key and exposes a ref callback to update them.
 */
function useSizes() {
  const [sizeMap, setSizeMap] = React.useState({});
  const setNodeSize = React.useCallback((key, node) => {
    if (!node) {
      setSizeMap(prevSizeMap => {
        if (!(key in prevSizeMap)) {
          return prevSizeMap;
        }
        const nextSizeMap = {
          ...prevSizeMap
        };
        delete nextSizeMap[key];
        return nextSizeMap;
      });
      return;
    }
    const nextSize = {
      width: node.offsetWidth,
      height: node.offsetHeight
    };
    setSizeMap(prevSizeMap => {
      const prevSize = prevSizeMap[key];
      if (prevSize && prevSize.width === nextSize.width && prevSize.height === nextSize.height) {
        return prevSizeMap;
      }
      return {
        ...prevSizeMap,
        [key]: nextSize
      };
    });
  }, []);
  return [sizeMap, setNodeSize];
}