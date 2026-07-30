"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ScrollAreaScrollbar = void 0;
var React = _interopRequireWildcard(require("react"));
var _addEventListener = require("@base-ui/utils/addEventListener");
var _utils = require("../../floating-ui-react/utils");
var _ScrollAreaRootContext = require("../root/ScrollAreaRootContext");
var _ScrollAreaScrollbarContext = require("./ScrollAreaScrollbarContext");
var _useRenderElement = require("../../internals/useRenderElement");
var _getOffset = require("../utils/getOffset");
var _ScrollAreaRootCssVars = require("../root/ScrollAreaRootCssVars");
var _ScrollAreaScrollbarCssVars = require("./ScrollAreaScrollbarCssVars");
var _DirectionContext = require("../../internals/direction-context/DirectionContext");
var _stateAttributes = require("../root/stateAttributes");
var _jsxRuntime = require("react/jsx-runtime");
/**
 * A vertical or horizontal scrollbar for the scroll area.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Scroll Area](https://base-ui.com/react/components/scroll-area)
 */
const ScrollAreaScrollbar = exports.ScrollAreaScrollbar = /*#__PURE__*/React.forwardRef(function ScrollAreaScrollbar(componentProps, forwardedRef) {
  const {
    render,
    className,
    orientation = 'vertical',
    keepMounted = false,
    style,
    ...elementProps
  } = componentProps;
  const {
    hovering,
    scrollingX,
    scrollingY,
    hiddenState,
    overflowEdges,
    scrollbarYRef,
    scrollbarXRef,
    viewportRef,
    thumbYRef,
    thumbXRef,
    handlePointerDown,
    handlePointerUp,
    handleScroll,
    rootId,
    thumbSize,
    hasMeasuredScrollbar
  } = (0, _ScrollAreaRootContext.useScrollAreaRootContext)();
  const state = {
    hovering,
    scrolling: {
      horizontal: scrollingX,
      vertical: scrollingY
    }[orientation],
    orientation,
    hasOverflowX: !hiddenState.x,
    hasOverflowY: !hiddenState.y,
    overflowXStart: overflowEdges.xStart,
    overflowXEnd: overflowEdges.xEnd,
    overflowYStart: overflowEdges.yStart,
    overflowYEnd: overflowEdges.yEnd,
    cornerHidden: hiddenState.corner
  };
  const direction = (0, _DirectionContext.useDirection)();
  const hideTrackUntilMeasured = !hasMeasuredScrollbar && !keepMounted;
  const isHidden = orientation === 'vertical' ? hiddenState.y : hiddenState.x;
  const shouldRender = keepMounted || !isHidden;
  React.useEffect(() => {
    if (!shouldRender) {
      return undefined;
    }
    const viewportEl = viewportRef.current;
    const scrollbarEl = orientation === 'vertical' ? scrollbarYRef.current : scrollbarXRef.current;
    if (!scrollbarEl) {
      return undefined;
    }
    function handleWheel(event) {
      if (!viewportEl || !scrollbarEl || event.ctrlKey) {
        return;
      }
      const horizontal = orientation === 'horizontal';
      const scrollProperty = horizontal ? 'scrollLeft' : 'scrollTop';
      const delta = horizontal ? event.deltaX : event.deltaY;
      if (delta === 0) {
        return;
      }
      const maxScroll = horizontal ? viewportEl.scrollWidth - viewportEl.clientWidth : viewportEl.scrollHeight - viewportEl.clientHeight;
      // RTL horizontal scrolling uses a negative `scrollLeft` range, from 0 to `-maxScroll`.
      const minScroll = horizontal && direction === 'rtl' ? -maxScroll : 0;
      const maxScrollValue = horizontal && direction === 'rtl' ? 0 : maxScroll;
      const scrollValue = viewportEl[scrollProperty];

      // At an edge (or with no overflow), let the wheel event chain to the
      // parent/page instead of swallowing it via `preventDefault`.
      if (scrollValue <= minScroll && delta < 0 || scrollValue >= maxScrollValue && delta > 0) {
        return;
      }
      event.preventDefault();
      viewportEl[scrollProperty] = Math.min(maxScrollValue, Math.max(minScroll, scrollValue + delta));
      handleScroll({
        x: viewportEl.scrollLeft,
        y: viewportEl.scrollTop
      });
    }
    return (0, _addEventListener.addEventListener)(scrollbarEl, 'wheel', handleWheel, {
      passive: false
    });
  }, [direction, handleScroll, orientation, scrollbarXRef, scrollbarYRef, shouldRender, viewportRef]);
  const props = {
    ...(rootId && {
      'data-id': `${rootId}-scrollbar`
    }),
    onPointerDown(event) {
      if (event.button !== 0) {
        return;
      }
      const target = (0, _utils.getTarget)(event.nativeEvent);
      const thumb = orientation === 'vertical' ? thumbYRef.current : thumbXRef.current;

      // Ignore clicks on thumb, including cases where React retargets the
      // synthetic event to the track host across a shadow boundary.
      if (thumb && (0, _utils.contains)(thumb, target)) {
        return;
      }
      if (!viewportRef.current) {
        return;
      }

      // Handle Y-axis (vertical) scroll
      if (thumbYRef.current && scrollbarYRef.current && orientation === 'vertical') {
        const thumbYOffset = (0, _getOffset.getOffset)(thumbYRef.current, 'margin', 'y');
        const scrollbarYOffset = (0, _getOffset.getOffset)(scrollbarYRef.current, 'padding', 'y');
        const thumbHeight = thumbYRef.current.offsetHeight;
        const trackRectY = scrollbarYRef.current.getBoundingClientRect();
        const clickY = event.clientY - trackRectY.top - thumbHeight / 2 - scrollbarYOffset + thumbYOffset / 2;
        const scrollableContentHeight = viewportRef.current.scrollHeight;
        const viewportHeight = viewportRef.current.clientHeight;
        const maxThumbOffsetY = scrollbarYRef.current.offsetHeight - thumbHeight - scrollbarYOffset - thumbYOffset;
        const scrollRatioY = clickY / maxThumbOffsetY;
        const newScrollTop = scrollRatioY * (scrollableContentHeight - viewportHeight);
        viewportRef.current.scrollTop = newScrollTop;
      }
      if (thumbXRef.current && scrollbarXRef.current && orientation === 'horizontal') {
        const thumbXOffset = (0, _getOffset.getOffset)(thumbXRef.current, 'margin', 'x');
        const scrollbarXOffset = (0, _getOffset.getOffset)(scrollbarXRef.current, 'padding', 'x');
        const thumbWidth = thumbXRef.current.offsetWidth;
        const trackRectX = scrollbarXRef.current.getBoundingClientRect();
        const clickX = event.clientX - trackRectX.left - thumbWidth / 2 - scrollbarXOffset + thumbXOffset / 2;
        const scrollableContentWidth = viewportRef.current.scrollWidth;
        const viewportWidth = viewportRef.current.clientWidth;
        const maxThumbOffsetX = scrollbarXRef.current.offsetWidth - thumbWidth - scrollbarXOffset - thumbXOffset;
        const scrollRatioX = clickX / maxThumbOffsetX;
        let newScrollLeft;
        if (direction === 'rtl') {
          // In RTL, invert the scroll direction
          newScrollLeft = (1 - scrollRatioX) * (scrollableContentWidth - viewportWidth);

          // Adjust for browsers that use negative scrollLeft in RTL
          if (viewportRef.current.scrollLeft <= 0) {
            newScrollLeft = -newScrollLeft;
          }
        } else {
          newScrollLeft = scrollRatioX * (scrollableContentWidth - viewportWidth);
        }
        viewportRef.current.scrollLeft = newScrollLeft;
      }
      handleScroll({
        x: viewportRef.current.scrollLeft,
        y: viewportRef.current.scrollTop
      });
      handlePointerDown(event);
    },
    onPointerUp: handlePointerUp,
    // Mirror `onPointerUp` so a browser-cancelled gesture on the track (no thumb
    // child captures the pointer) still clears the drag state.
    onPointerCancel: handlePointerUp,
    style: {
      position: 'absolute',
      touchAction: 'none',
      WebkitUserSelect: 'none',
      userSelect: 'none',
      visibility: hideTrackUntilMeasured ? 'hidden' : undefined,
      ...(orientation === 'vertical' && {
        top: 0,
        bottom: `var(${_ScrollAreaRootCssVars.ScrollAreaRootCssVars.scrollAreaCornerHeight})`,
        insetInlineEnd: 0,
        [_ScrollAreaScrollbarCssVars.ScrollAreaScrollbarCssVars.scrollAreaThumbHeight]: `${thumbSize.height}px`
      }),
      ...(orientation === 'horizontal' && {
        insetInlineStart: 0,
        insetInlineEnd: `var(${_ScrollAreaRootCssVars.ScrollAreaRootCssVars.scrollAreaCornerWidth})`,
        bottom: 0,
        [_ScrollAreaScrollbarCssVars.ScrollAreaScrollbarCssVars.scrollAreaThumbWidth]: `${thumbSize.width}px`
      })
    }
  };
  const element = (0, _useRenderElement.useRenderElement)('div', componentProps, {
    ref: [forwardedRef, orientation === 'vertical' ? scrollbarYRef : scrollbarXRef],
    state,
    props: [props, elementProps],
    stateAttributesMapping: _stateAttributes.scrollAreaStateAttributesMapping
  });
  const contextValue = React.useMemo(() => ({
    orientation
  }), [orientation]);
  if (!shouldRender) {
    return null;
  }
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_ScrollAreaScrollbarContext.ScrollAreaScrollbarContext.Provider, {
    value: contextValue,
    children: element
  });
});
if (process.env.NODE_ENV !== "production") ScrollAreaScrollbar.displayName = "ScrollAreaScrollbar";