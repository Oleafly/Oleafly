"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ScrollAreaThumb = void 0;
var React = _interopRequireWildcard(require("react"));
var _ScrollAreaRootContext = require("../root/ScrollAreaRootContext");
var _ScrollAreaScrollbarContext = require("../scrollbar/ScrollAreaScrollbarContext");
var _ScrollAreaScrollbarCssVars = require("../scrollbar/ScrollAreaScrollbarCssVars");
var _useRenderElement = require("../../internals/useRenderElement");
/**
 * The draggable part of the scrollbar that indicates the current scroll position.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Scroll Area](https://base-ui.com/react/components/scroll-area)
 */
const ScrollAreaThumb = exports.ScrollAreaThumb = /*#__PURE__*/React.forwardRef(function ScrollAreaThumb(componentProps, forwardedRef) {
  const {
    render,
    className,
    style,
    ...elementProps
  } = componentProps;
  const {
    thumbYRef,
    thumbXRef,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    setScrollingX,
    setScrollingY,
    scrollingX,
    scrollingY,
    hasMeasuredScrollbar
  } = (0, _ScrollAreaRootContext.useScrollAreaRootContext)();
  const {
    orientation
  } = (0, _ScrollAreaScrollbarContext.useScrollAreaScrollbarContext)();
  const state = {
    scrolling: orientation === 'horizontal' ? scrollingX : scrollingY,
    orientation
  };
  function endDrag(event) {
    if (orientation === 'vertical') {
      setScrollingY(false);
    }
    if (orientation === 'horizontal') {
      setScrollingX(false);
    }
    handlePointerUp(event);
  }
  const element = (0, _useRenderElement.useRenderElement)('div', componentProps, {
    ref: [forwardedRef, orientation === 'vertical' ? thumbYRef : thumbXRef],
    state,
    props: [{
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      style: {
        visibility: hasMeasuredScrollbar ? undefined : 'hidden',
        ...(orientation === 'vertical' && {
          height: `var(${_ScrollAreaScrollbarCssVars.ScrollAreaScrollbarCssVars.scrollAreaThumbHeight})`
        }),
        ...(orientation === 'horizontal' && {
          width: `var(${_ScrollAreaScrollbarCssVars.ScrollAreaScrollbarCssVars.scrollAreaThumbWidth})`
        })
      }
    }, elementProps]
  });
  return element;
});
if (process.env.NODE_ENV !== "production") ScrollAreaThumb.displayName = "ScrollAreaThumb";