"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ScrollAreaViewport = void 0;
var React = _interopRequireWildcard(require("react"));
var _useStableCallback = require("@base-ui/utils/useStableCallback");
var _useIsoLayoutEffect = require("@base-ui/utils/useIsoLayoutEffect");
var _platform = require("@base-ui/utils/platform");
var _useTimeout = require("@base-ui/utils/useTimeout");
var _ScrollAreaRootContext = require("../root/ScrollAreaRootContext");
var _ScrollAreaViewportContext = require("./ScrollAreaViewportContext");
var _useRenderElement = require("../../internals/useRenderElement");
var _DirectionContext = require("../../internals/direction-context/DirectionContext");
var _getOffset = require("../utils/getOffset");
var _constants = require("../constants");
var _clamp = require("../../internals/clamp");
var _styles = require("../../utils/styles");
var _stateAttributes = require("../root/stateAttributes");
var _ScrollAreaViewportCssVars = require("./ScrollAreaViewportCssVars");
var _scrollEdges = require("../../utils/scrollEdges");
var _jsxRuntime = require("react/jsx-runtime");
// Module-level flag to ensure we only register the CSS properties once,
// regardless of how many Scroll Area components are mounted.
let scrollAreaOverflowVarsRegistered = false;

/**
 * Removes inheritance of the scroll area overflow CSS variables, which
 * improves rendering performance in complex scroll areas with deep subtrees.
 * Instead, each child must manually opt-in to using these properties by
 * specifying `inherit`.
 * See https://motion.dev/blog/web-animation-performance-tier-list
 * under the "Improving CSS variable performance" section.
 */
function removeCSSVariableInheritance() {
  if (scrollAreaOverflowVarsRegistered ||
  // When `inherits: false`, specifying `inherit` on child elements doesn't work
  // in Safari. To let CSS features work correctly, this optimization must be skipped.
  _platform.platform.engine.webkit) {
    return;
  }
  if (typeof CSS !== 'undefined' && 'registerProperty' in CSS) {
    [_ScrollAreaViewportCssVars.ScrollAreaViewportCssVars.scrollAreaOverflowXStart, _ScrollAreaViewportCssVars.ScrollAreaViewportCssVars.scrollAreaOverflowXEnd, _ScrollAreaViewportCssVars.ScrollAreaViewportCssVars.scrollAreaOverflowYStart, _ScrollAreaViewportCssVars.ScrollAreaViewportCssVars.scrollAreaOverflowYEnd].forEach(name => {
      try {
        CSS.registerProperty({
          name,
          syntax: '<length>',
          inherits: false,
          initialValue: '0px'
        });
      } catch {
        /* ignore already-registered */
      }
    });
  }
  scrollAreaOverflowVarsRegistered = true;
}

/**
 * The actual scrollable container of the scroll area.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Scroll Area](https://base-ui.com/react/components/scroll-area)
 */
const ScrollAreaViewport = exports.ScrollAreaViewport = /*#__PURE__*/React.forwardRef(function ScrollAreaViewport(componentProps, forwardedRef) {
  const {
    render,
    className,
    style,
    ...elementProps
  } = componentProps;
  const {
    viewportRef,
    scrollbarYRef,
    scrollbarXRef,
    thumbYRef,
    thumbXRef,
    cornerRef,
    cornerSize,
    setCornerSize,
    setThumbSize,
    rootId,
    setHiddenState,
    hiddenState,
    setHasMeasuredScrollbar,
    handleScroll,
    setHovering,
    setOverflowEdges,
    overflowEdges,
    overflowEdgeThreshold,
    scrollingX,
    scrollingY
  } = (0, _ScrollAreaRootContext.useScrollAreaRootContext)();
  const direction = (0, _DirectionContext.useDirection)();
  const programmaticScrollRef = React.useRef(true);
  const lastMeasuredViewportMetricsRef = React.useRef([NaN, NaN, NaN, NaN]);
  const scrollEndTimeout = (0, _useTimeout.useTimeout)();
  const waitForAnimationsTimeout = (0, _useTimeout.useTimeout)();
  const computeThumbPosition = (0, _useStableCallback.useStableCallback)(() => {
    const viewportEl = viewportRef.current;
    const scrollbarYEl = scrollbarYRef.current;
    const scrollbarXEl = scrollbarXRef.current;
    const thumbYEl = thumbYRef.current;
    const thumbXEl = thumbXRef.current;
    const cornerEl = cornerRef.current;
    if (!viewportEl) {
      return;
    }
    const scrollableContentHeight = viewportEl.scrollHeight;
    const scrollableContentWidth = viewportEl.scrollWidth;
    const viewportHeight = viewportEl.clientHeight;
    const viewportWidth = viewportEl.clientWidth;
    const scrollTop = viewportEl.scrollTop;
    const scrollLeft = viewportEl.scrollLeft;
    const lastMeasuredViewportMetrics = lastMeasuredViewportMetricsRef.current;
    const isFirstMeasurement = Number.isNaN(lastMeasuredViewportMetrics[0]);
    lastMeasuredViewportMetrics[0] = viewportHeight;
    lastMeasuredViewportMetrics[1] = scrollableContentHeight;
    lastMeasuredViewportMetrics[2] = viewportWidth;
    lastMeasuredViewportMetrics[3] = scrollableContentWidth;
    if (isFirstMeasurement) {
      setHasMeasuredScrollbar(true);
    }
    if (scrollableContentHeight === 0 || scrollableContentWidth === 0) {
      return;
    }
    const nextHiddenState = getHiddenState(viewportEl);
    const scrollbarYHidden = nextHiddenState.y;
    const scrollbarXHidden = nextHiddenState.x;
    const ratioX = viewportWidth / scrollableContentWidth;
    const ratioY = viewportHeight / scrollableContentHeight;
    const maxScrollLeft = Math.max(0, scrollableContentWidth - viewportWidth);
    const maxScrollTop = Math.max(0, scrollableContentHeight - viewportHeight);
    let scrollLeftFromStart = 0;
    let scrollLeftFromEnd = 0;
    if (!scrollbarXHidden) {
      let rawScrollLeftFromStart = 0;
      if (direction === 'rtl') {
        rawScrollLeftFromStart = (0, _clamp.clamp)(-scrollLeft, 0, maxScrollLeft);
      } else {
        rawScrollLeftFromStart = (0, _clamp.clamp)(scrollLeft, 0, maxScrollLeft);
      }
      scrollLeftFromStart = (0, _scrollEdges.normalizeScrollOffset)(rawScrollLeftFromStart, maxScrollLeft);
      scrollLeftFromEnd = maxScrollLeft - scrollLeftFromStart;
    }
    const rawScrollTopFromStart = !scrollbarYHidden ? (0, _clamp.clamp)(scrollTop, 0, maxScrollTop) : 0;
    const scrollTopFromStart = !scrollbarYHidden ? (0, _scrollEdges.normalizeScrollOffset)(rawScrollTopFromStart, maxScrollTop) : 0;
    const scrollTopFromEnd = !scrollbarYHidden ? maxScrollTop - scrollTopFromStart : 0;
    const nextWidth = scrollbarXHidden ? 0 : viewportWidth;
    const nextHeight = scrollbarYHidden ? 0 : viewportHeight;
    let nextCornerWidth = 0;
    let nextCornerHeight = 0;
    if (!scrollbarXHidden && !scrollbarYHidden) {
      nextCornerWidth = scrollbarYEl?.offsetWidth || 0;
      nextCornerHeight = scrollbarXEl?.offsetHeight || 0;
    }

    // Only subtract corner size from scrollbar dimensions if the corner hasn't been sized yet.
    // Once sized, the layout will already account for it.
    const cornerNotYetSized = cornerSize.width === 0 && cornerSize.height === 0;
    const cornerWidthOffset = cornerNotYetSized ? nextCornerWidth : 0;
    const cornerHeightOffset = cornerNotYetSized ? nextCornerHeight : 0;
    const scrollbarXOffset = (0, _getOffset.getOffset)(scrollbarXEl, 'padding', 'x');
    const scrollbarYOffset = (0, _getOffset.getOffset)(scrollbarYEl, 'padding', 'y');
    const thumbXOffset = (0, _getOffset.getOffset)(thumbXEl, 'margin', 'x');
    const thumbYOffset = (0, _getOffset.getOffset)(thumbYEl, 'margin', 'y');
    const idealNextWidth = nextWidth - scrollbarXOffset - thumbXOffset;
    const idealNextHeight = nextHeight - scrollbarYOffset - thumbYOffset;
    const maxNextWidth = scrollbarXEl ? Math.min(scrollbarXEl.offsetWidth - cornerWidthOffset, idealNextWidth) : idealNextWidth;
    const maxNextHeight = scrollbarYEl ? Math.min(scrollbarYEl.offsetHeight - cornerHeightOffset, idealNextHeight) : idealNextHeight;
    const clampedNextWidth = Math.max(_constants.MIN_THUMB_SIZE, maxNextWidth * ratioX);
    const clampedNextHeight = Math.max(_constants.MIN_THUMB_SIZE, maxNextHeight * ratioY);
    setThumbSize(prevSize => {
      if (prevSize.height === clampedNextHeight && prevSize.width === clampedNextWidth) {
        return prevSize;
      }
      return {
        width: clampedNextWidth,
        height: clampedNextHeight
      };
    });

    // Handle Y (vertical) scroll
    if (scrollbarYEl && thumbYEl) {
      const maxThumbOffsetY = scrollbarYEl.offsetHeight - clampedNextHeight - scrollbarYOffset - thumbYOffset;
      const scrollRangeY = scrollableContentHeight - viewportHeight;
      const scrollRatioY = scrollRangeY === 0 ? 0 : scrollTop / scrollRangeY;

      // In Safari, don't allow it to go negative or too far as `scrollTop` considers the rubber
      // band effect.
      const thumbOffsetY = Math.min(maxThumbOffsetY, Math.max(0, scrollRatioY * maxThumbOffsetY));
      thumbYEl.style.transform = `translate3d(0,${thumbOffsetY}px,0)`;
    }

    // Handle X (horizontal) scroll
    if (scrollbarXEl && thumbXEl) {
      const maxThumbOffsetX = scrollbarXEl.offsetWidth - clampedNextWidth - scrollbarXOffset - thumbXOffset;
      const scrollRangeX = scrollableContentWidth - viewportWidth;
      const scrollRatioX = scrollRangeX === 0 ? 0 : scrollLeft / scrollRangeX;

      // In Safari, don't allow it to go negative or too far as `scrollLeft` considers the rubber
      // band effect.
      const thumbOffsetX = direction === 'rtl' ? (0, _clamp.clamp)(scrollRatioX * maxThumbOffsetX, -maxThumbOffsetX, 0) : (0, _clamp.clamp)(scrollRatioX * maxThumbOffsetX, 0, maxThumbOffsetX);
      thumbXEl.style.transform = `translate3d(${thumbOffsetX}px,0,0)`;
    }
    const overflowMetricsPx = [[_ScrollAreaViewportCssVars.ScrollAreaViewportCssVars.scrollAreaOverflowXStart, scrollLeftFromStart], [_ScrollAreaViewportCssVars.ScrollAreaViewportCssVars.scrollAreaOverflowXEnd, scrollLeftFromEnd], [_ScrollAreaViewportCssVars.ScrollAreaViewportCssVars.scrollAreaOverflowYStart, scrollTopFromStart], [_ScrollAreaViewportCssVars.ScrollAreaViewportCssVars.scrollAreaOverflowYEnd, scrollTopFromEnd]];
    for (const [cssVar, value] of overflowMetricsPx) {
      viewportEl.style.setProperty(cssVar, `${value}px`);
    }
    if (cornerEl) {
      if (scrollbarXHidden || scrollbarYHidden) {
        setCornerSize({
          width: 0,
          height: 0
        });
      } else if (!scrollbarXHidden && !scrollbarYHidden) {
        setCornerSize({
          width: nextCornerWidth,
          height: nextCornerHeight
        });
      }
    }
    setHiddenState(prevState => mergeHiddenState(prevState, nextHiddenState));
    const nextOverflowEdges = {
      xStart: !scrollbarXHidden && scrollLeftFromStart > overflowEdgeThreshold.xStart,
      xEnd: !scrollbarXHidden && scrollLeftFromEnd > overflowEdgeThreshold.xEnd,
      yStart: !scrollbarYHidden && scrollTopFromStart > overflowEdgeThreshold.yStart,
      yEnd: !scrollbarYHidden && scrollTopFromEnd > overflowEdgeThreshold.yEnd
    };
    setOverflowEdges(prev => {
      if (prev.xStart === nextOverflowEdges.xStart && prev.xEnd === nextOverflowEdges.xEnd && prev.yStart === nextOverflowEdges.yStart && prev.yEnd === nextOverflowEdges.yEnd) {
        return prev;
      }
      return nextOverflowEdges;
    });
  });
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    if (!viewportRef.current) {
      return;
    }
    removeCSSVariableInheritance();
  }, [viewportRef]);
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    // Wait for scrollbar and thumb refs after hidden-state toggles, refresh math on direction
    // flips, and re-evaluate overflow edges when the threshold changes.
    queueMicrotask(computeThumbPosition);
  }, [computeThumbPosition, hiddenState, direction, overflowEdgeThreshold.xStart, overflowEdgeThreshold.xEnd, overflowEdgeThreshold.yStart, overflowEdgeThreshold.yEnd]);
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    // `onMouseEnter` doesn't fire upon load, so we need to check if the viewport is already
    // being hovered.
    if (viewportRef.current?.matches(':hover')) {
      setHovering(true);
    }
  }, [viewportRef, setHovering]);
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    const viewport = viewportRef.current;
    if (typeof ResizeObserver === 'undefined' || !viewport) {
      return undefined;
    }
    let hasInitialized = false;
    const resizeObserver = new ResizeObserver(() => {
      // Avoid duplicate mount-time recompute when observer data matches what the mount
      // scheduling pass already measured. If dimensions changed before the first observer
      // delivery, keep the recompute so overflow transitions stay in sync.
      if (!hasInitialized) {
        hasInitialized = true;
        const lastMeasuredViewportMetrics = lastMeasuredViewportMetricsRef.current;
        if (lastMeasuredViewportMetrics[0] === viewport.clientHeight && lastMeasuredViewportMetrics[1] === viewport.scrollHeight && lastMeasuredViewportMetrics[2] === viewport.clientWidth && lastMeasuredViewportMetrics[3] === viewport.scrollWidth) {
          return;
        }
      }
      computeThumbPosition();
    });
    resizeObserver.observe(viewport);

    // Wait for subtree animations to finish, then recompute thumb geometry that
    // may have been affected by transform-based animations.
    waitForAnimationsTimeout.start(0, () => {
      const animations = viewport.getAnimations({
        subtree: true
      });
      if (animations.length === 0) {
        return;
      }
      Promise.allSettled(animations.map(animation => animation.finished)).then(computeThumbPosition).catch(() => {});
    });
    return () => {
      resizeObserver.disconnect();
      waitForAnimationsTimeout.clear();
    };
  }, [computeThumbPosition, viewportRef, waitForAnimationsTimeout]);
  function handleUserInteraction() {
    programmaticScrollRef.current = false;
  }
  const props = {
    role: 'presentation',
    ...(rootId && {
      'data-id': `${rootId}-viewport`
    }),
    // https://accessibilityinsights.io/info-examples/web/scrollable-region-focusable/
    // Keep non-scrollable viewports out of tab order.
    tabIndex: hiddenState.x && hiddenState.y ? -1 : 0,
    className: _styles.styleDisableScrollbar.className,
    style: {
      overflow: 'scroll'
    },
    onScroll() {
      if (!viewportRef.current) {
        return;
      }
      computeThumbPosition();
      if (!programmaticScrollRef.current) {
        handleScroll({
          x: viewportRef.current.scrollLeft,
          y: viewportRef.current.scrollTop
        });
      }

      // Debounce the restoration of the programmatic flag so that it only
      // flips back to `true` once scrolling has come to a rest. This ensures
      // that momentum scrolling (where no further user-interaction events fire)
      // is still treated as user-driven.
      // 100 ms without scroll events ≈ scroll end
      // https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollend_event
      scrollEndTimeout.start(100, () => {
        programmaticScrollRef.current = true;
      });
    },
    onWheel: handleUserInteraction,
    onTouchMove: handleUserInteraction,
    onPointerMove: handleUserInteraction,
    onPointerEnter: handleUserInteraction,
    onKeyDown: handleUserInteraction
  };
  const viewportState = React.useMemo(() => ({
    scrolling: scrollingX || scrollingY,
    hasOverflowX: !hiddenState.x,
    hasOverflowY: !hiddenState.y,
    overflowXStart: overflowEdges.xStart,
    overflowXEnd: overflowEdges.xEnd,
    overflowYStart: overflowEdges.yStart,
    overflowYEnd: overflowEdges.yEnd,
    cornerHidden: hiddenState.corner
  }), [scrollingX, scrollingY, hiddenState.x, hiddenState.y, hiddenState.corner, overflowEdges]);
  const element = (0, _useRenderElement.useRenderElement)('div', componentProps, {
    ref: [forwardedRef, viewportRef],
    state: viewportState,
    props: [props, elementProps],
    stateAttributesMapping: _stateAttributes.scrollAreaStateAttributesMapping
  });
  const contextValue = React.useMemo(() => ({
    computeThumbPosition
  }), [computeThumbPosition]);
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_ScrollAreaViewportContext.ScrollAreaViewportContext.Provider, {
    value: contextValue,
    children: element
  });
});
if (process.env.NODE_ENV !== "production") ScrollAreaViewport.displayName = "ScrollAreaViewport";
function getHiddenState(viewport) {
  const y = viewport.clientHeight >= viewport.scrollHeight;
  const x = viewport.clientWidth >= viewport.scrollWidth;
  return {
    y,
    x,
    corner: y || x
  };
}
function mergeHiddenState(prevState, nextState) {
  if (prevState.y === nextState.y && prevState.x === nextState.x && prevState.corner === nextState.corner) {
    return prevState;
  }
  return nextState;
}