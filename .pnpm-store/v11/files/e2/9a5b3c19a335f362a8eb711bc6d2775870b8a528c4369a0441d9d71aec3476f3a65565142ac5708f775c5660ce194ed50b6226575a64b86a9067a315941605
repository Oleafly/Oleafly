"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = useAccessibility;
var _util = require("@rc-component/util");
var React = _interopRequireWildcard(require("react"));
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && Object.prototype.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
const {
  ESC,
  TAB
} = _util.KeyCode;
function useAccessibility({
  visible,
  triggerRef,
  onVisibleChange,
  autoFocus,
  overlayRef
}) {
  const focusMenuRef = React.useRef(false);
  const handleCloseMenuAndReturnFocus = () => {
    if (visible) {
      triggerRef.current?.focus?.();
      onVisibleChange?.(false);
    }
  };
  const focusMenu = () => {
    if (overlayRef.current?.focus) {
      overlayRef.current.focus();
      focusMenuRef.current = true;
      return true;
    }
    return false;
  };
  const handleKeyDown = event => {
    switch (event.keyCode) {
      case ESC:
        handleCloseMenuAndReturnFocus();
        break;
      case TAB:
        {
          let focusResult = false;
          if (!focusMenuRef.current) {
            focusResult = focusMenu();
          }
          if (focusResult) {
            event.preventDefault();
          } else {
            handleCloseMenuAndReturnFocus();
          }
          break;
        }
    }
  };
  React.useEffect(() => {
    if (visible) {
      window.addEventListener('keydown', handleKeyDown);
      if (autoFocus) {
        // FIXME: hack with raf
        (0, _util.raf)(focusMenu, 3);
      }
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        focusMenuRef.current = false;
      };
    }
    return () => {
      focusMenuRef.current = false;
    };
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
}