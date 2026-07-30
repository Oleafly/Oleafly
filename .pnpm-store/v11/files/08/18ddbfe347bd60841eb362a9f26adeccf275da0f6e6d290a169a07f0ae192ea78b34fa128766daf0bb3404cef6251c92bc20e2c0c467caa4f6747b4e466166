"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useWatch;
var _util = require("@rc-component/util");
var _util2 = require("../util");
function useWatch(open, target, popup, onAlign, onScroll) {
  (0, _util.useLayoutEffect)(() => {
    if (open && target && popup) {
      const targetElement = target;
      const popupElement = popup;
      const targetScrollList = (0, _util2.collectScroller)(targetElement);
      const popupScrollList = (0, _util2.collectScroller)(popupElement);
      const win = (0, _util2.getWin)(popupElement);
      const mergedList = new Set([win, ...targetScrollList, ...popupScrollList]);
      function notifyScroll() {
        onAlign();
        onScroll();
      }
      mergedList.forEach(scroller => {
        scroller.addEventListener('scroll', notifyScroll, {
          passive: true
        });
      });
      win.addEventListener('resize', notifyScroll, {
        passive: true
      });

      // First time always do align
      onAlign();
      return () => {
        mergedList.forEach(scroller => {
          scroller.removeEventListener('scroll', notifyScroll);
          win.removeEventListener('resize', notifyScroll);
        });
      };
    }
  }, [open, target, popup]);
}