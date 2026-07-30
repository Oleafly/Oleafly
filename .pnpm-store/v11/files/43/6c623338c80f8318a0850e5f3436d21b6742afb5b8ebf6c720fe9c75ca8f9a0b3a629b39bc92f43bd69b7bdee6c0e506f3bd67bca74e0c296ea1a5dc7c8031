"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ScrollAreaRoot = void 0;
var React = _interopRequireWildcard(require("react"));
var _useStableCallback = require("@base-ui/utils/useStableCallback");
var _useTimeout = require("@base-ui/utils/useTimeout");
var _ScrollAreaRootContext = require("./ScrollAreaRootContext");
var _useRenderElement = require("../../internals/useRenderElement");
var _ScrollAreaRootCssVars = require("./ScrollAreaRootCssVars");
var _constants = require("../constants");
var _getOffset = require("../utils/getOffset");
var _ScrollAreaScrollbarDataAttributes = require("../scrollbar/ScrollAreaScrollbarDataAttributes");
var _styles = require("../../utils/styles");
var _useBaseUiId = require("../../internals/useBaseUiId");
var _stateAttributes = require("./stateAttributes");
var _utils = require("../../floating-ui-react/utils");
var _CSPContext = require("../../internals/csp-context/CSPContext");
var _jsxRuntime = require("react/jsx-runtime");
const DEFAULT_COORDS = {
  x: 0,
  y: 0
};
const DEFAULT_SIZE = {
  width: 0,
  height: 0
};
const DEFAULT_OVERFLOW_EDGES = {
  xStart: false,
  xEnd: false,
  yStart: false,
  yEnd: false
};
const DEFAULT_HIDDEN_STATE = {
  x: true,
  y: true,
  corner: true
};
/**
 * Groups all parts of the scroll area.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Scroll Area](https://base-ui.com/react/components/scroll-area)
 */
const ScrollAreaRoot = exports.ScrollAreaRoot = /*#__PURE__*/React.forwardRef(function ScrollAreaRoot(componentProps, forwardedRef) {
  const {
    render,
    className,
    overflowEdgeThreshold: overflowEdgeThresholdProp,
    style,
    ...elementProps
  } = componentProps;
  const {
    xStart,
    xEnd,
    yStart,
    yEnd
  } = normalizeOverflowEdgeThreshold(overflowEdgeThresholdProp);
  const rootId = (0, _useBaseUiId.useBaseUiId)();
  const scrollYTimeout = (0, _useTimeout.useTimeout)();
  const scrollXTimeout = (0, _useTimeout.useTimeout)();
  const {
    nonce,
    disableStyleElements
  } = (0, _CSPContext.useCSPContext)();
  const [hovering, setHovering] = React.useState(false);
  const [scrollingX, setScrollingX] = React.useState(false);
  const [scrollingY, setScrollingY] = React.useState(false);
  const [touchModality, setTouchModality] = React.useState(false);
  const [hasMeasuredScrollbar, setHasMeasuredScrollbar] = React.useState(false);
  const [cornerSize, setCornerSize] = React.useState(DEFAULT_SIZE);
  const [thumbSize, setThumbSize] = React.useState(DEFAULT_SIZE);
  const [overflowEdges, setOverflowEdges] = React.useState(DEFAULT_OVERFLOW_EDGES);
  const [hiddenState, setHiddenState] = React.useState(DEFAULT_HIDDEN_STATE);
  const rootRef = React.useRef(null);
  const viewportRef = React.useRef(null);
  const scrollbarYRef = React.useRef(null);
  const scrollbarXRef = React.useRef(null);
  const thumbYRef = React.useRef(null);
  const thumbXRef = React.useRef(null);
  const cornerRef = React.useRef(null);
  const thumbDraggingRef = React.useRef(false);
  const startYRef = React.useRef(0);
  const startXRef = React.useRef(0);
  const startScrollTopRef = React.useRef(0);
  const startScrollLeftRef = React.useRef(0);
  const currentOrientationRef = React.useRef('vertical');
  const scrollPositionRef = React.useRef(DEFAULT_COORDS);
  const handleScroll = (0, _useStableCallback.useStableCallback)(scrollPosition => {
    const offsetX = scrollPosition.x - scrollPositionRef.current.x;
    const offsetY = scrollPosition.y - scrollPositionRef.current.y;
    scrollPositionRef.current = scrollPosition;
    if (offsetY !== 0) {
      setScrollingY(true);
      scrollYTimeout.start(_constants.SCROLL_TIMEOUT, () => {
        setScrollingY(false);
      });
    }
    if (offsetX !== 0) {
      setScrollingX(true);
      scrollXTimeout.start(_constants.SCROLL_TIMEOUT, () => {
        setScrollingX(false);
      });
    }
  });
  const handlePointerDown = (0, _useStableCallback.useStableCallback)(event => {
    if (event.button !== 0) {
      return;
    }
    thumbDraggingRef.current = true;
    startYRef.current = event.clientY;
    startXRef.current = event.clientX;
    currentOrientationRef.current = event.currentTarget.getAttribute(_ScrollAreaScrollbarDataAttributes.ScrollAreaScrollbarDataAttributes.orientation);
    if (viewportRef.current) {
      startScrollTopRef.current = viewportRef.current.scrollTop;
      startScrollLeftRef.current = viewportRef.current.scrollLeft;
    }
    if (thumbYRef.current && currentOrientationRef.current === 'vertical') {
      thumbYRef.current.setPointerCapture(event.pointerId);
    }
    if (thumbXRef.current && currentOrientationRef.current === 'horizontal') {
      thumbXRef.current.setPointerCapture(event.pointerId);
    }
  });
  const handlePointerMove = (0, _useStableCallback.useStableCallback)(event => {
    if (!thumbDraggingRef.current) {
      return;
    }
    const deltaY = event.clientY - startYRef.current;
    const deltaX = event.clientX - startXRef.current;
    if (viewportRef.current) {
      const scrollableContentHeight = viewportRef.current.scrollHeight;
      const viewportHeight = viewportRef.current.clientHeight;
      const scrollableContentWidth = viewportRef.current.scrollWidth;
      const viewportWidth = viewportRef.current.clientWidth;
      if (thumbYRef.current && scrollbarYRef.current && currentOrientationRef.current === 'vertical') {
        const scrollbarYOffset = (0, _getOffset.getOffset)(scrollbarYRef.current, 'padding', 'y');
        const thumbYOffset = (0, _getOffset.getOffset)(thumbYRef.current, 'margin', 'y');
        const thumbHeight = thumbYRef.current.offsetHeight;
        const maxThumbOffsetY = scrollbarYRef.current.offsetHeight - thumbHeight - scrollbarYOffset - thumbYOffset;
        const scrollRatioY = deltaY / maxThumbOffsetY;
        viewportRef.current.scrollTop = startScrollTopRef.current + scrollRatioY * (scrollableContentHeight - viewportHeight);
        event.preventDefault();
        setScrollingY(true);
        scrollYTimeout.start(_constants.SCROLL_TIMEOUT, () => {
          setScrollingY(false);
        });
      }
      if (thumbXRef.current && scrollbarXRef.current && currentOrientationRef.current === 'horizontal') {
        const scrollbarXOffset = (0, _getOffset.getOffset)(scrollbarXRef.current, 'padding', 'x');
        const thumbXOffset = (0, _getOffset.getOffset)(thumbXRef.current, 'margin', 'x');
        const thumbWidth = thumbXRef.current.offsetWidth;
        const maxThumbOffsetX = scrollbarXRef.current.offsetWidth - thumbWidth - scrollbarXOffset - thumbXOffset;
        const scrollRatioX = deltaX / maxThumbOffsetX;
        viewportRef.current.scrollLeft = startScrollLeftRef.current + scrollRatioX * (scrollableContentWidth - viewportWidth);
        event.preventDefault();
        setScrollingX(true);
        scrollXTimeout.start(_constants.SCROLL_TIMEOUT, () => {
          setScrollingX(false);
        });
      }
    }
  });
  const handlePointerUp = (0, _useStableCallback.useStableCallback)(event => {
    thumbDraggingRef.current = false;

    // `pointercancel` releases capture implicitly, so guard against releasing a
    // capture we no longer hold (which would throw).
    if (thumbYRef.current && currentOrientationRef.current === 'vertical' && thumbYRef.current.hasPointerCapture(event.pointerId)) {
      thumbYRef.current.releasePointerCapture(event.pointerId);
    }
    if (thumbXRef.current && currentOrientationRef.current === 'horizontal' && thumbXRef.current.hasPointerCapture(event.pointerId)) {
      thumbXRef.current.releasePointerCapture(event.pointerId);
    }
  });
  function handleTouchModalityChange(event) {
    setTouchModality(event.pointerType === 'touch');
  }
  function handlePointerEnterOrMove(event) {
    handleTouchModalityChange(event);
    if (event.pointerType !== 'touch') {
      const isTargetRootChild = (0, _utils.contains)(rootRef.current, event.target);
      setHovering(isTargetRootChild);
    }
  }
  const state = React.useMemo(() => ({
    scrolling: scrollingX || scrollingY,
    hasOverflowX: !hiddenState.x,
    hasOverflowY: !hiddenState.y,
    overflowXStart: overflowEdges.xStart,
    overflowXEnd: overflowEdges.xEnd,
    overflowYStart: overflowEdges.yStart,
    overflowYEnd: overflowEdges.yEnd,
    cornerHidden: hiddenState.corner
  }), [scrollingX, scrollingY, hiddenState.x, hiddenState.y, hiddenState.corner, overflowEdges]);
  const props = {
    role: 'presentation',
    onPointerEnter: handlePointerEnterOrMove,
    onPointerMove: handlePointerEnterOrMove,
    onPointerDown: handleTouchModalityChange,
    onPointerLeave() {
      setHovering(false);
    },
    style: {
      position: 'relative',
      [_ScrollAreaRootCssVars.ScrollAreaRootCssVars.scrollAreaCornerHeight]: `${cornerSize.height}px`,
      [_ScrollAreaRootCssVars.ScrollAreaRootCssVars.scrollAreaCornerWidth]: `${cornerSize.width}px`
    }
  };
  const element = (0, _useRenderElement.useRenderElement)('div', componentProps, {
    state,
    ref: [forwardedRef, rootRef],
    props: [props, elementProps],
    stateAttributesMapping: _stateAttributes.scrollAreaStateAttributesMapping
  });
  const contextValue = React.useMemo(() => ({
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleScroll,
    cornerSize,
    setCornerSize,
    thumbSize,
    setThumbSize,
    hasMeasuredScrollbar,
    setHasMeasuredScrollbar,
    touchModality,
    cornerRef,
    scrollingX,
    setScrollingX,
    scrollingY,
    setScrollingY,
    hovering,
    setHovering,
    viewportRef,
    rootRef,
    scrollbarYRef,
    scrollbarXRef,
    thumbYRef,
    thumbXRef,
    rootId,
    hiddenState,
    setHiddenState,
    overflowEdges,
    setOverflowEdges,
    viewportState: state,
    overflowEdgeThreshold: {
      xStart,
      xEnd,
      yStart,
      yEnd
    }
  }), [handlePointerDown, handlePointerMove, handlePointerUp, handleScroll, cornerSize, thumbSize, hasMeasuredScrollbar, touchModality, scrollingX, setScrollingX, scrollingY, setScrollingY, hovering, setHovering, rootId, hiddenState, overflowEdges, state, xStart, xEnd, yStart, yEnd]);
  return /*#__PURE__*/(0, _jsxRuntime.jsxs)(_ScrollAreaRootContext.ScrollAreaRootContext.Provider, {
    value: contextValue,
    children: [!disableStyleElements && _styles.styleDisableScrollbar.getElement(nonce), element]
  });
});
if (process.env.NODE_ENV !== "production") ScrollAreaRoot.displayName = "ScrollAreaRoot";
function normalizeOverflowEdgeThreshold(threshold) {
  if (typeof threshold === 'number') {
    const value = Math.max(0, threshold);
    return {
      xStart: value,
      xEnd: value,
      yStart: value,
      yEnd: value
    };
  }
  return {
    xStart: Math.max(0, threshold?.xStart || 0),
    xEnd: Math.max(0, threshold?.xEnd || 0),
    yStart: Math.max(0, threshold?.yStart || 0),
    yEnd: Math.max(0, threshold?.yEnd || 0)
  };
}