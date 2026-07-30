'use client';

import * as React from 'react';
import { useScrollAreaRootContext } from "../root/ScrollAreaRootContext.mjs";
import { useScrollAreaScrollbarContext } from "../scrollbar/ScrollAreaScrollbarContext.mjs";
import { ScrollAreaScrollbarCssVars } from "../scrollbar/ScrollAreaScrollbarCssVars.mjs";
import { useRenderElement } from "../../internals/useRenderElement.mjs";

/**
 * The draggable part of the scrollbar that indicates the current scroll position.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Scroll Area](https://base-ui.com/react/components/scroll-area)
 */
export const ScrollAreaThumb = /*#__PURE__*/React.forwardRef(function ScrollAreaThumb(componentProps, forwardedRef) {
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
  } = useScrollAreaRootContext();
  const {
    orientation
  } = useScrollAreaScrollbarContext();
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
  const element = useRenderElement('div', componentProps, {
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
          height: `var(${ScrollAreaScrollbarCssVars.scrollAreaThumbHeight})`
        }),
        ...(orientation === 'horizontal' && {
          width: `var(${ScrollAreaScrollbarCssVars.scrollAreaThumbWidth})`
        })
      }
    }, elementProps]
  });
  return element;
});
if (process.env.NODE_ENV !== "production") ScrollAreaThumb.displayName = "ScrollAreaThumb";