"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useListPosition;
var React = _interopRequireWildcard(require("react"));
var _useSizes = _interopRequireDefault(require("./useSizes"));
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
/**
 * Calculates each notification's position and the full list height.
 */
function useListPosition(configList, stack, gap = 0) {
  const [sizeMap, setNodeSize] = (0, _useSizes.default)();
  const [notificationPosition, totalHeight, topNoticeHeight, topNoticeWidth] = React.useMemo(() => {
    let offsetY = 0;
    let nextTotalHeight = 0;
    const stackThreshold = stack?.threshold ?? 0;
    const nextNotificationPosition = new Map();
    let nextTopNoticeHeight;
    let nextTopNoticeWidth;
    configList.slice().reverse().forEach((config, index) => {
      // Walk from newest to oldest so each notice can be positioned after the ones below it.
      const key = String(config.key);
      const height = sizeMap[key]?.height ?? 0;
      const y = stack && index > 0 ? offsetY + (stack.offset ?? 0) - height : offsetY;
      nextNotificationPosition.set(key, y);
      if (index === 0) {
        nextTopNoticeHeight = height;
        nextTopNoticeWidth = sizeMap[key]?.width ?? 0;
      }
      if (!stack || index < stackThreshold) {
        nextTotalHeight = Math.max(nextTotalHeight, y + height);
      }
      if (stack) {
        offsetY = y + height;
      } else {
        offsetY += height + gap;
      }
    });
    return [nextNotificationPosition, nextTotalHeight, nextTopNoticeHeight, nextTopNoticeWidth];
  }, [configList, gap, sizeMap, stack]);
  return [notificationPosition, setNodeSize, totalHeight, topNoticeHeight, topNoticeWidth];
}