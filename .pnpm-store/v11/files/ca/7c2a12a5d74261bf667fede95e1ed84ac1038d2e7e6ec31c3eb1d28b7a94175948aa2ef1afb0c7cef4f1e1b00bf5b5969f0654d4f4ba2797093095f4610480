"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useScrollLocker;
var React = _interopRequireWildcard(require("react"));
var _util = require("@rc-component/util");
var _util2 = require("./util");
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
const UNIQUE_ID = `rc-util-locker-${Date.now()}`;
let uuid = 0;
function useScrollLocker(lock) {
  const mergedLock = !!lock;
  const [id] = React.useState(() => {
    uuid += 1;
    return `${UNIQUE_ID}_${uuid}`;
  });
  (0, _util.useLayoutEffect)(() => {
    if (mergedLock) {
      const scrollbarSize = (0, _util.getTargetScrollBarSize)(document.body).width;
      const isOverflow = (0, _util2.isBodyOverflowing)();
      (0, _util.updateCSS)(`
html body {
  overflow-y: hidden;
  ${isOverflow ? `width: calc(100% - ${scrollbarSize}px);` : ''}
}`, id);
    } else {
      (0, _util.removeCSS)(id);
    }
    return () => {
      (0, _util.removeCSS)(id);
    };
  }, [mergedLock, id]);
}