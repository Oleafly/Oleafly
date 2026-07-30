"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useHeights;
var _react = _interopRequireWildcard(require("react"));
var React = _react;
var _CacheMap = _interopRequireDefault(require("../utils/CacheMap"));
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
function parseNumber(value) {
  const num = parseFloat(value);
  return isNaN(num) ? 0 : num;
}
function useHeights(getKey, onItemAdd, onItemRemove) {
  const [updatedMark, setUpdatedMark] = React.useState(0);
  const instanceRef = (0, _react.useRef)(new Map());
  const heightsRef = (0, _react.useRef)(new _CacheMap.default());
  const promiseIdRef = (0, _react.useRef)(0);
  function cancelRaf() {
    promiseIdRef.current += 1;
  }
  function collectHeight(sync = false) {
    cancelRaf();
    const doCollect = () => {
      let changed = false;
      instanceRef.current.forEach((element, key) => {
        if (element && element.offsetParent) {
          const {
            offsetHeight
          } = element;
          const {
            marginTop,
            marginBottom
          } = getComputedStyle(element);
          const marginTopNum = parseNumber(marginTop);
          const marginBottomNum = parseNumber(marginBottom);
          const totalHeight = offsetHeight + marginTopNum + marginBottomNum;
          if (heightsRef.current.get(key) !== totalHeight) {
            heightsRef.current.set(key, totalHeight);
            changed = true;
          }
        }
      });

      // Always trigger update mark to tell parent that should re-calculate heights when resized
      if (changed) {
        setUpdatedMark(c => c + 1);
      }
    };
    if (sync) {
      doCollect();
    } else {
      promiseIdRef.current += 1;
      const id = promiseIdRef.current;
      Promise.resolve().then(() => {
        if (id === promiseIdRef.current) {
          doCollect();
        }
      });
    }
  }
  function setInstanceRef(item, instance) {
    const key = getKey(item);
    const origin = instanceRef.current.get(key);
    if (instance) {
      instanceRef.current.set(key, instance);
      collectHeight();
    } else {
      instanceRef.current.delete(key);
    }

    // Instance changed
    if (!origin !== !instance) {
      if (instance) {
        onItemAdd?.(item);
      } else {
        onItemRemove?.(item);
      }
    }
  }
  (0, _react.useEffect)(() => {
    return cancelRaf;
  }, []);
  return [setInstanceRef, collectHeight, heightsRef.current, updatedMark];
}