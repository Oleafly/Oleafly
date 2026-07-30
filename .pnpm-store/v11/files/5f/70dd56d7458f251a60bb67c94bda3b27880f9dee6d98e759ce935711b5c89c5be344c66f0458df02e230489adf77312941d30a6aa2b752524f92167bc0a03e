"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useGetSize = useGetSize;
var React = _interopRequireWildcard(require("react"));
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
/**
 * Size info need loop query for the `heights` which will has the perf issue.
 * Let cache result for each render phase.
 */
function useGetSize(mergedData, getKey, heights, itemHeight) {
  const [key2Index, bottomList] = React.useMemo(() => [new Map(), []], [mergedData, heights.id, itemHeight]);
  const getSize = (startKey, endKey = startKey) => {
    // Get from cache first
    let startIndex = key2Index.get(startKey);
    let endIndex = key2Index.get(endKey);

    // Loop to fill the cache
    if (startIndex === undefined || endIndex === undefined) {
      const dataLen = mergedData.length;
      for (let i = bottomList.length; i < dataLen; i += 1) {
        const item = mergedData[i];
        const key = getKey(item);
        key2Index.set(key, i);
        const cacheHeight = heights.get(key) ?? itemHeight;
        bottomList[i] = (bottomList[i - 1] || 0) + cacheHeight;
        if (key === startKey) {
          startIndex = i;
        }
        if (key === endKey) {
          endIndex = i;
        }
        if (startIndex !== undefined && endIndex !== undefined) {
          break;
        }
      }
    }
    return {
      top: bottomList[startIndex - 1] || 0,
      bottom: bottomList[endIndex]
    };
  };
  return getSize;
}