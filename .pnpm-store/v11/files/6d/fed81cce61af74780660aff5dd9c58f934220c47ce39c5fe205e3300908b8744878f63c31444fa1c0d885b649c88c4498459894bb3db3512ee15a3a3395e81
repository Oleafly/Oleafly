"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useRangeActive;
var React = _interopRequireWildcard(require("react"));
var _useLockEffect = _interopRequireDefault(require("./useLockEffect"));
function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
/**
 * When user first focus one input, any submit will trigger focus another one.
 * When second time focus one input, submit will not trigger focus again.
 * When click outside to close the panel, trigger event if it can trigger onChange.
 */
function useRangeActive(disabled, empty = [], mergedOpen = false) {
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [focused, setFocused] = React.useState(false);
  const activeListRef = React.useRef([]);
  const submitIndexRef = React.useRef(null);
  const lastOperationRef = React.useRef(null);
  const updateSubmitIndex = index => {
    submitIndexRef.current = index;
  };
  const hasActiveSubmitValue = index => {
    return submitIndexRef.current === index;
  };
  const triggerFocus = nextFocus => {
    setFocused(nextFocus);
  };

  // ============================= Record =============================
  const lastOperation = type => {
    if (type) {
      lastOperationRef.current = type;
    }
    return lastOperationRef.current;
  };

  // ============================ Strategy ============================
  // Trigger when input enter or input blur or panel close
  const nextActiveIndex = nextValue => {
    const list = activeListRef.current;
    const filledActiveSet = new Set(list.filter(index => nextValue[index] || empty[index]));
    const nextIndex = list[list.length - 1] === 0 ? 1 : 0;
    if (filledActiveSet.size >= 2 || disabled[nextIndex]) {
      return null;
    }
    return nextIndex;
  };

  // ============================= Effect =============================
  // Wait in case it's from the click outside to blur
  (0, _useLockEffect.default)(focused || mergedOpen, () => {
    if (!focused) {
      activeListRef.current = [];
      updateSubmitIndex(null);
    }
  });
  React.useEffect(() => {
    if (focused) {
      activeListRef.current.push(activeIndex);
    }
  }, [focused, activeIndex]);
  return [focused, triggerFocus, lastOperation, activeIndex, setActiveIndex, nextActiveIndex, activeListRef.current, updateSubmitIndex, hasActiveSubmitValue];
}