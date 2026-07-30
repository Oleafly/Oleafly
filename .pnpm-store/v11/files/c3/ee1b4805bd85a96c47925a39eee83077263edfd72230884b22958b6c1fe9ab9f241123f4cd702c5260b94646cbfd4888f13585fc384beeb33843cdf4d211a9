"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ToastContent = void 0;
var React = _interopRequireWildcard(require("react"));
var _useIsoLayoutEffect = require("@base-ui/utils/useIsoLayoutEffect");
var _ToastRootContext = require("../root/ToastRootContext");
var _useRenderElement = require("../../internals/useRenderElement");
/**
 * A container for the contents of a toast.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Toast](https://base-ui.com/react/components/toast)
 */
const ToastContent = exports.ToastContent = /*#__PURE__*/React.forwardRef(function ToastContent(componentProps, forwardedRef) {
  const {
    render,
    className,
    style,
    ...elementProps
  } = componentProps;
  const {
    visibleIndex,
    expanded,
    recalculateHeight
  } = (0, _ToastRootContext.useToastRootContext)();
  const contentRef = React.useRef(null);
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    const node = contentRef.current;
    if (!node) {
      return undefined;
    }
    recalculateHeight();
    if (typeof ResizeObserver !== 'function' || typeof MutationObserver !== 'function') {
      return undefined;
    }
    const resizeObserver = new ResizeObserver(() => recalculateHeight(true));
    const mutationObserver = new MutationObserver(() => recalculateHeight(true));
    resizeObserver.observe(node);
    mutationObserver.observe(node, {
      childList: true,
      subtree: true,
      characterData: true
    });
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [recalculateHeight]);
  const behind = visibleIndex > 0;
  const state = {
    expanded,
    behind
  };
  const element = (0, _useRenderElement.useRenderElement)('div', componentProps, {
    ref: [forwardedRef, contentRef],
    state,
    props: elementProps
  });
  return element;
});
if (process.env.NODE_ENV !== "production") ToastContent.displayName = "ToastContent";