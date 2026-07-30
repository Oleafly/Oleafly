"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useScrollTo;
var React = _interopRequireWildcard(require("react"));
var _util = require("@rc-component/util");
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
const MAX_TIMES = 10;
function getOffset(rawOffset, info) {
  const resolvedOffset = typeof rawOffset === 'function' ? rawOffset(info) : rawOffset;
  return Number.isFinite(resolvedOffset) ? resolvedOffset : 0;
}
function useScrollTo(containerRef, data, heights, itemHeight, getKey, getSize, collectHeight, syncScrollTop, triggerFlash) {
  const scrollRef = React.useRef(undefined);
  const [syncState, setSyncState] = React.useState(null);

  // ========================== Sync Scroll ==========================
  (0, _util.useLayoutEffect)(() => {
    if (syncState && syncState.times < MAX_TIMES) {
      // Never reach
      if (!containerRef.current) {
        setSyncState(ori => ({
          ...ori
        }));
        return;
      }
      collectHeight();
      const {
        targetAlign,
        originAlign,
        index,
        offset: rawOffset
      } = syncState;
      const mergedAlign = targetAlign || originAlign;
      const offset = getOffset(rawOffset, {
        getSize,
        align: mergedAlign
      });
      const height = containerRef.current.clientHeight;
      let needCollectHeight = false;
      let newTargetAlign = targetAlign;
      let targetTop = null;

      // Go to next frame if height not exist
      if (height) {
        // Get top & bottom
        let stackTop = 0;
        let itemTop = 0;
        let itemBottom = 0;
        const maxLen = Math.min(data.length - 1, index);
        for (let i = 0; i <= maxLen; i += 1) {
          const key = getKey(data[i]);
          itemTop = stackTop;
          const cacheHeight = heights.get(key);
          itemBottom = itemTop + (cacheHeight === undefined ? itemHeight : cacheHeight);
          stackTop = itemBottom;
        }

        // Check if need sync height (visible range has item not record height)
        let leftHeight = mergedAlign === 'top' ? offset : height - offset;
        for (let i = maxLen; i >= 0; i -= 1) {
          const key = getKey(data[i]);
          const cacheHeight = heights.get(key);
          if (cacheHeight === undefined) {
            needCollectHeight = true;
            break;
          }
          leftHeight -= cacheHeight;
          if (leftHeight <= 0) {
            break;
          }
        }

        // Scroll to
        switch (mergedAlign) {
          case 'top':
            targetTop = itemTop - offset;
            break;
          case 'bottom':
            targetTop = itemBottom - height + offset;
            break;
          default:
            {
              const {
                scrollTop
              } = containerRef.current;
              const scrollBottom = scrollTop + height;
              if (itemTop < scrollTop) {
                newTargetAlign = 'top';
              } else if (itemBottom > scrollBottom) {
                newTargetAlign = 'bottom';
              }
            }
        }
        if (targetTop !== null) {
          syncScrollTop(targetTop);
        }

        // One more time for sync
        if (targetTop !== syncState.lastTop) {
          needCollectHeight = true;
        }
      }

      // Trigger next effect
      if (needCollectHeight) {
        setSyncState({
          ...syncState,
          times: syncState.times + 1,
          targetAlign: newTargetAlign,
          lastTop: targetTop
        });
      }
    } else if (process.env.NODE_ENV !== 'production' && syncState?.times === MAX_TIMES) {
      (0, _util.warning)(false, 'Seems `scrollTo` with `rc-virtual-list` reach the max limitation. Please fire issue for us. Thanks.');
    }
  }, [syncState, containerRef.current]);

  // =========================== Scroll To ===========================
  return arg => {
    // When not argument provided, we think dev may want to show the scrollbar
    if (arg === null || arg === undefined) {
      triggerFlash();
      return;
    }

    // Normal scroll logic
    _util.raf.cancel(scrollRef.current);
    if (typeof arg === 'number') {
      syncScrollTop(arg);
    } else if (arg && typeof arg === 'object') {
      let index;
      const {
        align
      } = arg;
      if ('index' in arg) {
        ({
          index
        } = arg);
      } else {
        index = data.findIndex(item => getKey(item) === arg.key);
      }
      const {
        offset: rawOffset = 0
      } = arg;
      setSyncState({
        times: 0,
        index,
        offset: rawOffset,
        originAlign: align
      });
    }
  };
}