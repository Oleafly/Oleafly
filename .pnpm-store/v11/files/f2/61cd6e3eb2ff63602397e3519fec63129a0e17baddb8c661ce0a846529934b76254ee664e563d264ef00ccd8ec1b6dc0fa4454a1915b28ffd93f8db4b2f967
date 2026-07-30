"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.useAnchorPositioning = useAnchorPositioning;
var React = _interopRequireWildcard(require("react"));
var _utils = require("@floating-ui/utils");
var _owner = require("@base-ui/utils/owner");
var _useIsoLayoutEffect = require("@base-ui/utils/useIsoLayoutEffect");
var _useValueAsRef = require("@base-ui/utils/useValueAsRef");
var _useStableCallback = require("@base-ui/utils/useStableCallback");
var _floatingUiReact = require("../floating-ui-react");
var _DirectionContext = require("../internals/direction-context/DirectionContext");
var _arrow = require("../floating-ui-react/middleware/arrow");
var _hideMiddleware = require("./hideMiddleware");
var _adaptiveOriginMiddleware = require("./adaptiveOriginMiddleware");
function getLogicalSide(sideParam, renderedSide, isRtl) {
  const isLogicalSideParam = sideParam === 'inline-start' || sideParam === 'inline-end';
  const logicalRight = isRtl ? 'inline-start' : 'inline-end';
  const logicalLeft = isRtl ? 'inline-end' : 'inline-start';
  return {
    top: 'top',
    right: isLogicalSideParam ? logicalRight : 'right',
    bottom: 'bottom',
    left: isLogicalSideParam ? logicalLeft : 'left'
  }[renderedSide];
}
function getOffsetData(state, sideParam, isRtl) {
  const {
    rects,
    placement
  } = state;
  const data = {
    side: getLogicalSide(sideParam, (0, _utils.getSide)(placement), isRtl),
    align: (0, _utils.getAlignment)(placement) || 'center',
    anchor: {
      width: rects.reference.width,
      height: rects.reference.height
    },
    positioner: {
      width: rects.floating.width,
      height: rects.floating.height
    }
  };
  return data;
}
/**
 * Provides standardized anchor positioning behavior for floating elements. Wraps Floating UI's
 * `useFloating` hook.
 */
function useAnchorPositioning(params) {
  const {
    // Public parameters
    anchor,
    positionMethod = 'absolute',
    side: sideParam = 'bottom',
    sideOffset = 0,
    align = 'center',
    alignOffset = 0,
    collisionBoundary,
    collisionPadding: collisionPaddingParam = 5,
    sticky = false,
    arrowPadding = 5,
    disableAnchorTracking = false,
    inline: inlineMiddleware,
    // Private parameters
    keepMounted = false,
    floatingRootContext,
    mounted,
    collisionAvoidance,
    shiftCrossAxis = false,
    nodeId,
    adaptiveOrigin,
    lazyFlip = false,
    externalTree
  } = params;
  const [mountSide, setMountSide] = React.useState(null);
  if (!mounted && mountSide !== null) {
    setMountSide(null);
  }
  const collisionAvoidanceSide = collisionAvoidance.side || 'flip';
  const collisionAvoidanceAlign = collisionAvoidance.align || 'flip';
  const collisionAvoidanceFallbackAxisSide = collisionAvoidance.fallbackAxisSide || 'end';
  const anchorFn = typeof anchor === 'function' ? anchor : undefined;
  const anchorFnCallback = (0, _useStableCallback.useStableCallback)(anchorFn);
  const anchorDep = anchorFn ? anchorFnCallback : anchor;
  const anchorValueRef = (0, _useValueAsRef.useValueAsRef)(anchor);
  const mountedRef = (0, _useValueAsRef.useValueAsRef)(mounted);
  const direction = (0, _DirectionContext.useDirection)();
  const isRtl = direction === 'rtl';
  const side = mountSide || {
    top: 'top',
    right: 'right',
    bottom: 'bottom',
    left: 'left',
    'inline-end': isRtl ? 'left' : 'right',
    'inline-start': isRtl ? 'right' : 'left'
  }[sideParam];
  const placement = align === 'center' ? side : `${side}-${align}`;
  let collisionPadding = collisionPaddingParam;

  // Create a bias to the preferred side.
  // On iOS, when the mobile software keyboard opens, the input is exactly centered
  // in the viewport, but this can cause it to flip to the top undesirably.
  const bias = 1;
  const biasTop = sideParam === 'bottom' ? bias : 0;
  const biasBottom = sideParam === 'top' ? bias : 0;
  const biasLeft = sideParam === 'right' ? bias : 0;
  const biasRight = sideParam === 'left' ? bias : 0;
  if (typeof collisionPadding === 'number') {
    collisionPadding = {
      top: collisionPadding + biasTop,
      right: collisionPadding + biasRight,
      bottom: collisionPadding + biasBottom,
      left: collisionPadding + biasLeft
    };
  } else if (collisionPadding) {
    collisionPadding = {
      top: (collisionPadding.top || 0) + biasTop,
      right: (collisionPadding.right || 0) + biasRight,
      bottom: (collisionPadding.bottom || 0) + biasBottom,
      left: (collisionPadding.left || 0) + biasLeft
    };
  }
  const commonCollisionProps = {
    boundary: collisionBoundary === 'clipping-ancestors' ? 'clippingAncestors' : collisionBoundary,
    padding: collisionPadding
  };

  // Using a ref assumes that the arrow element is always present in the DOM for the lifetime of the
  // popup. If this assumption ends up being false, we can switch to state to manage the arrow's
  // presence.
  const arrowRef = React.useRef(null);

  // Keep these reactive if they're not functions
  const sideOffsetRef = (0, _useValueAsRef.useValueAsRef)(sideOffset);
  const alignOffsetRef = (0, _useValueAsRef.useValueAsRef)(alignOffset);
  const sideOffsetDep = typeof sideOffset !== 'function' ? sideOffset : 0;
  const alignOffsetDep = typeof alignOffset !== 'function' ? alignOffset : 0;
  const middleware = [];
  if (inlineMiddleware) {
    middleware.push(inlineMiddleware);
  }
  middleware.push((0, _floatingUiReact.offset)(state => {
    const data = getOffsetData(state, sideParam, isRtl);
    const sideAxis = typeof sideOffsetRef.current === 'function' ? sideOffsetRef.current(data) : sideOffsetRef.current;
    const alignAxis = typeof alignOffsetRef.current === 'function' ? alignOffsetRef.current(data) : alignOffsetRef.current;
    return {
      mainAxis: sideAxis,
      crossAxis: alignAxis,
      alignmentAxis: alignAxis
    };
  }, [sideOffsetDep, alignOffsetDep, isRtl, sideParam]));
  const shiftDisabled = collisionAvoidanceAlign === 'none' && collisionAvoidanceSide !== 'shift';
  const crossAxisShiftEnabled = !shiftDisabled && (sticky || shiftCrossAxis || collisionAvoidanceSide === 'shift');
  const flipMiddleware = collisionAvoidanceSide === 'none' ? null : (0, _floatingUiReact.flip)({
    ...commonCollisionProps,
    // Ensure the popup flips if it's been limited by its --available-height and it resizes.
    // Since the size() padding is smaller than the flip() padding, flip() will take precedence.
    padding: {
      top: collisionPadding.top + bias,
      right: collisionPadding.right + bias,
      bottom: collisionPadding.bottom + bias,
      left: collisionPadding.left + bias
    },
    mainAxis: !shiftCrossAxis && collisionAvoidanceSide === 'flip',
    crossAxis: collisionAvoidanceAlign === 'flip' ? 'alignment' : false,
    fallbackAxisSideDirection: collisionAvoidanceFallbackAxisSide
  });
  const shiftMiddleware = shiftDisabled ? null : (0, _floatingUiReact.shift)(data => {
    const html = (0, _owner.ownerDocument)(data.elements.floating).documentElement;
    return {
      ...commonCollisionProps,
      // Use the Layout Viewport to avoid shifting around when pinch-zooming
      // for context menus.
      rootBoundary: shiftCrossAxis ? {
        x: 0,
        y: 0,
        width: html.clientWidth,
        height: html.clientHeight
      } : undefined,
      mainAxis: collisionAvoidanceAlign !== 'none',
      crossAxis: crossAxisShiftEnabled,
      limiter: sticky || shiftCrossAxis ? undefined : (0, _floatingUiReact.limitShift)(limitData => {
        if (!arrowRef.current) {
          return {};
        }
        const {
          width,
          height
        } = arrowRef.current.getBoundingClientRect();
        const sideAxis = (0, _utils.getSideAxis)((0, _utils.getSide)(limitData.placement));
        const arrowSize = sideAxis === 'y' ? width : height;
        const offsetAmount = sideAxis === 'y' ? collisionPadding.left + collisionPadding.right : collisionPadding.top + collisionPadding.bottom;
        return {
          offset: arrowSize / 2 + offsetAmount / 2
        };
      })
    };
  }, [commonCollisionProps, sticky, shiftCrossAxis, collisionPadding, collisionAvoidanceAlign]);

  // https://floating-ui.com/docs/flip#combining-with-shift
  if (collisionAvoidanceSide === 'shift' || collisionAvoidanceAlign === 'shift' || align === 'center') {
    middleware.push(shiftMiddleware, flipMiddleware);
  } else {
    middleware.push(flipMiddleware, shiftMiddleware);
  }
  middleware.push((0, _floatingUiReact.size)({
    ...commonCollisionProps,
    apply({
      elements: {
        floating
      },
      availableWidth,
      availableHeight,
      rects
    }) {
      if (!mountedRef.current) {
        return;
      }
      const floatingStyle = floating.style;
      floatingStyle.setProperty('--available-width', `${availableWidth}px`);
      floatingStyle.setProperty('--available-height', `${availableHeight}px`);

      // Snap anchor dimensions to device pixels to ensure the popup's visual width matches the anchor's one.
      const dpr = (0, _owner.ownerWindow)(floating).devicePixelRatio || 1;
      const {
        x,
        y,
        width,
        height
      } = rects.reference;
      const anchorWidth = (Math.round((x + width) * dpr) - Math.round(x * dpr)) / dpr;
      const anchorHeight = (Math.round((y + height) * dpr) - Math.round(y * dpr)) / dpr;
      floatingStyle.setProperty('--anchor-width', `${anchorWidth}px`);
      floatingStyle.setProperty('--anchor-height', `${anchorHeight}px`);
    }
  }), (0, _arrow.arrow)(state => ({
    // `transform-origin` calculations rely on an element existing. If the arrow hasn't been set,
    // we'll create a fake element.
    element: arrowRef.current || (0, _owner.ownerDocument)(state.elements.floating).createElement('div'),
    padding: arrowPadding,
    offsetParent: 'floating'
  }), [arrowPadding]), {
    name: 'transformOrigin',
    fn(state) {
      const {
        elements,
        middlewareData,
        placement: renderedPlacement,
        rects,
        y
      } = state;
      const currentRenderedSide = (0, _utils.getSide)(renderedPlacement);
      const currentRenderedAxis = (0, _utils.getSideAxis)(currentRenderedSide);
      const arrowEl = arrowRef.current;
      const arrowX = middlewareData.arrow?.x || 0;
      const arrowY = middlewareData.arrow?.y || 0;
      const arrowWidth = arrowEl?.clientWidth || 0;
      const arrowHeight = arrowEl?.clientHeight || 0;
      const transformX = arrowX + arrowWidth / 2;
      const transformY = arrowY + arrowHeight / 2;
      const shiftY = Math.abs(middlewareData.shift?.y || 0);
      const halfAnchorHeight = rects.reference.height / 2;
      const sideOffsetValue = typeof sideOffset === 'function' ? sideOffset(getOffsetData(state, sideParam, isRtl)) : sideOffset;
      const isOverlappingAnchor = shiftY > sideOffsetValue;
      const adjacentTransformOrigin = {
        top: `${transformX}px calc(100% + ${sideOffsetValue}px)`,
        bottom: `${transformX}px ${-sideOffsetValue}px`,
        left: `calc(100% + ${sideOffsetValue}px) ${transformY}px`,
        right: `${-sideOffsetValue}px ${transformY}px`
      }[currentRenderedSide];
      const overlapTransformOrigin = `${transformX}px ${rects.reference.y + halfAnchorHeight - y}px`;
      elements.floating.style.setProperty('--transform-origin', crossAxisShiftEnabled && currentRenderedAxis === 'y' && isOverlappingAnchor ? overlapTransformOrigin : adjacentTransformOrigin);
      return {};
    }
  }, _hideMiddleware.hide, adaptiveOrigin);
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    // Ensure positioning doesn't run initially for `keepMounted` elements that
    // aren't initially open.
    if (!mounted && floatingRootContext) {
      floatingRootContext.update({
        referenceElement: null,
        floatingElement: null,
        domReferenceElement: null,
        positionReference: null
      });
    }
  }, [mounted, floatingRootContext]);
  const autoUpdateOptions = React.useMemo(() => ({
    elementResize: !disableAnchorTracking && typeof ResizeObserver !== 'undefined',
    layoutShift: !disableAnchorTracking && typeof IntersectionObserver !== 'undefined'
  }), [disableAnchorTracking]);
  const {
    refs,
    elements,
    x,
    y,
    middlewareData,
    update,
    placement: renderedPlacement,
    context,
    isPositioned,
    floatingStyles: originalFloatingStyles
  } = (0, _floatingUiReact.useFloating)({
    rootContext: floatingRootContext,
    open: keepMounted ? mounted : undefined,
    placement,
    middleware,
    strategy: positionMethod,
    whileElementsMounted: keepMounted ? undefined : (...args) => (0, _floatingUiReact.autoUpdate)(...args, autoUpdateOptions),
    nodeId,
    externalTree
  });
  const {
    sideX,
    sideY
  } = middlewareData.adaptiveOrigin || _adaptiveOriginMiddleware.DEFAULT_SIDES;

  // Default to `fixed` when not positioned to prevent `autoFocus` scroll jumps.
  // This ensures the popup is inside the viewport initially before it gets positioned.
  const resolvedPosition = isPositioned ? positionMethod : 'fixed';
  const floatingStyles = React.useMemo(() => {
    const base = adaptiveOrigin ? {
      position: resolvedPosition,
      [sideX]: x,
      [sideY]: y
    } : {
      position: resolvedPosition,
      ...originalFloatingStyles
    };
    if (!isPositioned) {
      base.opacity = 0;
    }
    return base;
  }, [adaptiveOrigin, resolvedPosition, sideX, x, sideY, y, originalFloatingStyles, isPositioned]);
  const registeredPositionReferenceRef = React.useRef(null);
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    if (!mounted) {
      return;
    }
    const anchorValue = anchorValueRef.current;
    const resolvedAnchor = typeof anchorValue === 'function' ? anchorValue() : anchorValue;
    const unwrappedElement = (isRef(resolvedAnchor) ? resolvedAnchor.current : resolvedAnchor) || null;
    const finalAnchor = unwrappedElement || null;
    if (finalAnchor !== registeredPositionReferenceRef.current) {
      refs.setPositionReference(finalAnchor);
      registeredPositionReferenceRef.current = finalAnchor;
    }
  }, [mounted, refs, anchorDep, anchorValueRef]);
  React.useEffect(() => {
    if (!mounted) {
      return;
    }
    const anchorValue = anchorValueRef.current;

    // Refs from parent components are set after useLayoutEffect runs and are available in useEffect.
    // Therefore, if the anchor is a ref, we need to update the position reference in useEffect.
    if (typeof anchorValue === 'function') {
      return;
    }
    if (isRef(anchorValue) && anchorValue.current !== registeredPositionReferenceRef.current) {
      refs.setPositionReference(anchorValue.current);
      registeredPositionReferenceRef.current = anchorValue.current;
    }
  }, [mounted, refs, anchorDep, anchorValueRef]);
  React.useEffect(() => {
    if (keepMounted && mounted && elements.reference && elements.floating) {
      return (0, _floatingUiReact.autoUpdate)(elements.reference, elements.floating, update, autoUpdateOptions);
    }
    return undefined;
  }, [keepMounted, mounted, elements, update, autoUpdateOptions]);
  const renderedSide = (0, _utils.getSide)(renderedPlacement);
  const logicalRenderedSide = getLogicalSide(sideParam, renderedSide, isRtl);
  const renderedAlign = (0, _utils.getAlignment)(renderedPlacement) || 'center';
  const anchorHidden = Boolean(middlewareData.hide?.referenceHidden);

  // Locks the flip (makes it "sticky") so it doesn't prefer a given placement
  // and flips back lazily, not eagerly. Ideal for filtered lists that change
  // the size of the popup dynamically to avoid unwanted flipping when typing.
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    if (lazyFlip && mounted && isPositioned) {
      setMountSide(renderedSide);
    }
  }, [lazyFlip, mounted, isPositioned, renderedSide]);
  const arrowStyles = React.useMemo(() => ({
    position: 'absolute',
    top: middlewareData.arrow?.y,
    left: middlewareData.arrow?.x
  }), [middlewareData.arrow]);
  const arrowUncentered = middlewareData.arrow?.centerOffset !== 0;
  return React.useMemo(() => ({
    positionerStyles: floatingStyles,
    arrowStyles,
    arrowRef,
    arrowUncentered,
    side: logicalRenderedSide,
    align: renderedAlign,
    physicalSide: renderedSide,
    anchorHidden,
    refs,
    context,
    isPositioned,
    update
  }), [floatingStyles, arrowStyles, arrowRef, arrowUncentered, logicalRenderedSide, renderedAlign, renderedSide, anchorHidden, refs, context, isPositioned, update]);
}
function isRef(param) {
  return param != null && 'current' in param;
}