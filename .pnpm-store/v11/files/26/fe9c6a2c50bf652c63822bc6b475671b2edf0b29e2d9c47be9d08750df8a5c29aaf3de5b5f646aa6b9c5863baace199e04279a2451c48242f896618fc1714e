"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useScrollDrag;
exports.getPageXY = getPageXY;
var _util = require("@rc-component/util");
var React = _interopRequireWildcard(require("react"));
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function smoothScrollOffset(offset) {
  return Math.floor(offset ** 0.5);
}
function getPageXY(e, horizontal) {
  const obj = 'touches' in e ? e.touches[0] : e;
  return obj[horizontal ? 'pageX' : 'pageY'] - window[horizontal ? 'scrollX' : 'scrollY'];
}
function useScrollDrag(inVirtual, componentRef, onScrollOffset) {
  React.useEffect(() => {
    const ele = componentRef.current;
    if (inVirtual && ele) {
      let mouseDownLock = false;
      let rafId;
      let offset;
      const stopScroll = () => {
        _util.raf.cancel(rafId);
      };
      const continueScroll = () => {
        stopScroll();
        rafId = (0, _util.raf)(() => {
          onScrollOffset(offset);
          continueScroll();
        });
      };
      const clearDragState = () => {
        mouseDownLock = false;
        stopScroll();
      };
      const onMouseDown = e => {
        // Skip if element set draggable
        if (e.target.draggable || e.button !== 0) {
          return;
        }
        // Skip if nest List has handled this event
        const event = e;
        if (!event._virtualHandled) {
          event._virtualHandled = true;
          mouseDownLock = true;
        }
      };
      const onMouseMove = e => {
        if (mouseDownLock) {
          const mouseY = getPageXY(e, false);
          const {
            top,
            bottom
          } = ele.getBoundingClientRect();
          if (mouseY <= top) {
            const diff = top - mouseY;
            offset = -smoothScrollOffset(diff);
            continueScroll();
          } else if (mouseY >= bottom) {
            const diff = mouseY - bottom;
            offset = smoothScrollOffset(diff);
            continueScroll();
          } else {
            stopScroll();
          }
        }
      };
      ele.addEventListener('mousedown', onMouseDown);
      ele.ownerDocument.addEventListener('mouseup', clearDragState);
      ele.ownerDocument.addEventListener('mousemove', onMouseMove);
      ele.ownerDocument.addEventListener('dragend', clearDragState);
      return () => {
        ele.removeEventListener('mousedown', onMouseDown);
        ele.ownerDocument.removeEventListener('mouseup', clearDragState);
        ele.ownerDocument.removeEventListener('mousemove', onMouseMove);
        ele.ownerDocument.removeEventListener('dragend', clearDragState);
        stopScroll();
      };
    }
  }, [inVirtual]);
}