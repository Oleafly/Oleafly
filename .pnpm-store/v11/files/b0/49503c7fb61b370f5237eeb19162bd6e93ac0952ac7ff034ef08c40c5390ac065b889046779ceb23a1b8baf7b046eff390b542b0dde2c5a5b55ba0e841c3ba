"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useScrollTo;
var _util = require("@rc-component/util");
var React = _interopRequireWildcard(require("react"));
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
const SPEED_PTG = 1 / 3;
function useScrollTo(ulRef, value) {
  // ========================= Scroll =========================
  const scrollingRef = React.useRef(false);
  const scrollRafRef = React.useRef(null);
  const scrollDistRef = React.useRef(null);
  const isScrolling = () => scrollingRef.current;
  const stopScroll = () => {
    _util.raf.cancel(scrollRafRef.current);
    scrollingRef.current = false;
  };
  const scrollRafTimesRef = React.useRef();
  const startScroll = () => {
    const ul = ulRef.current;
    scrollDistRef.current = null;
    scrollRafTimesRef.current = 0;
    if (ul) {
      const targetLi = ul.querySelector(`[data-value="${value}"]`);
      const firstLi = ul.querySelector(`li`);
      const doScroll = () => {
        stopScroll();
        scrollingRef.current = true;
        scrollRafTimesRef.current += 1;
        const {
          scrollTop: currentTop
        } = ul;
        const firstLiTop = firstLi.offsetTop;
        const targetLiTop = targetLi.offsetTop;
        const targetTop = targetLiTop - firstLiTop;

        // Wait for element exist. 5 frames is enough
        if (targetLiTop === 0 && targetLi !== firstLi || !(0, _util.isVisible)(ul)) {
          if (scrollRafTimesRef.current <= 5) {
            scrollRafRef.current = (0, _util.raf)(doScroll);
          }
          return;
        }
        const nextTop = currentTop + (targetTop - currentTop) * SPEED_PTG;
        const dist = Math.abs(targetTop - nextTop);

        // Break if dist get larger, which means user is scrolling
        if (scrollDistRef.current !== null && scrollDistRef.current < dist) {
          stopScroll();
          return;
        }
        scrollDistRef.current = dist;

        // Stop when dist is less than 1
        if (dist <= 1) {
          ul.scrollTop = targetTop;
          stopScroll();
          return;
        }

        // IE not support `scrollTo`
        ul.scrollTop = nextTop;
        scrollRafRef.current = (0, _util.raf)(doScroll);
      };
      if (targetLi && firstLi) {
        doScroll();
      }
    }
  };

  // ======================== Trigger =========================
  const syncScroll = (0, _util.useEvent)(startScroll);
  return [syncScroll, stopScroll, isScrolling];
}