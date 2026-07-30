"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getSnapPointSwipeMovement = getSnapPointSwipeMovement;
exports.useDrawerSnapPoints = useDrawerSnapPoints;
var React = _interopRequireWildcard(require("react"));
var _useIsoLayoutEffect = require("@base-ui/utils/useIsoLayoutEffect");
var _useStableCallback = require("@base-ui/utils/useStableCallback");
var _owner = require("@base-ui/utils/owner");
var _clamp = require("../../internals/clamp");
var _DialogRootContext = require("../../dialog/root/DialogRootContext");
var _DrawerRootContext = require("./DrawerRootContext");
/**
 * Resolves the vertical swipe movement for a snap point, applying square-root damping once the drag
 * overshoots the fully-open edge (`nextOffset < 0`) so the popup resists travelling past it.
 */
function getSnapPointSwipeMovement(baseOffset, movementValue) {
  const nextOffset = baseOffset + movementValue;
  if (nextOffset >= 0) {
    return movementValue;
  }
  return -Math.sqrt(-nextOffset) - baseOffset;
}
function resolveSnapPointValue(snapPoint, viewportHeight, rootFontSize) {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    return null;
  }
  if (typeof snapPoint === 'number') {
    if (!Number.isFinite(snapPoint)) {
      return null;
    }
    if (snapPoint <= 1) {
      return (0, _clamp.clamp)(snapPoint, 0, 1) * viewportHeight;
    }
    return snapPoint;
  }
  const trimmed = snapPoint.trim();
  if (trimmed.endsWith('px')) {
    const value = Number.parseFloat(trimmed);
    return Number.isFinite(value) ? value : null;
  }
  if (trimmed.endsWith('rem')) {
    const value = Number.parseFloat(trimmed);
    return Number.isFinite(value) ? value * rootFontSize : null;
  }
  return null;
}
function findClosestSnapPoint(height, points) {
  let closest = null;
  let closestDistance = Infinity;
  for (const point of points) {
    const distance = Math.abs(point.height - height);
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = point;
    }
  }
  return closest;
}
function useDrawerSnapPoints() {
  const {
    store
  } = (0, _DialogRootContext.useDialogRootContext)();
  const {
    snapPoints,
    activeSnapPoint,
    setActiveSnapPoint,
    popupHeight
  } = (0, _DrawerRootContext.useDrawerRootContext)();
  const viewportElement = store.useState('viewportElement');
  const [viewportHeight, setViewportHeight] = React.useState(0);
  const [rootFontSize, setRootFontSize] = React.useState(16);
  const measureViewportHeight = (0, _useStableCallback.useStableCallback)(() => {
    const doc = (0, _owner.ownerDocument)(viewportElement);
    const html = doc.documentElement;
    if (viewportElement) {
      setViewportHeight(viewportElement.offsetHeight);
    }
    if (!viewportElement) {
      setViewportHeight(html.clientHeight);
    }
    const fontSize = parseFloat(getComputedStyle(html).fontSize);
    if (Number.isFinite(fontSize)) {
      setRootFontSize(fontSize);
    }
  });
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    measureViewportHeight();
    if (!viewportElement || typeof ResizeObserver !== 'function') {
      return undefined;
    }
    const resizeObserver = new ResizeObserver(measureViewportHeight);
    resizeObserver.observe(viewportElement);
    return () => {
      resizeObserver.disconnect();
    };
  }, [measureViewportHeight, viewportElement]);
  const resolvedSnapPoints = React.useMemo(() => {
    if (!snapPoints || snapPoints.length === 0 || viewportHeight <= 0 || popupHeight <= 0) {
      return [];
    }
    const maxHeight = Math.min(popupHeight, viewportHeight);
    if (!Number.isFinite(maxHeight) || maxHeight <= 0) {
      return [];
    }
    const resolved = snapPoints.map(value => {
      const resolvedHeight = resolveSnapPointValue(value, viewportHeight, rootFontSize);
      if (resolvedHeight === null || !Number.isFinite(resolvedHeight)) {
        return null;
      }
      const clampedHeight = (0, _clamp.clamp)(resolvedHeight, 0, maxHeight);
      return {
        value,
        height: clampedHeight,
        offset: Math.max(0, popupHeight - clampedHeight)
      };
    }).filter(point => Boolean(point));
    if (resolved.length <= 1) {
      return resolved;
    }
    const deduped = [];
    const seenHeights = [];
    for (let index = resolved.length - 1; index >= 0; index -= 1) {
      const point = resolved[index];
      const isDuplicate = seenHeights.some(height => Math.abs(height - point.height) <= 1);
      if (isDuplicate) {
        continue;
      }
      seenHeights.push(point.height);
      deduped.push(point);
    }
    deduped.reverse();
    return deduped;
  }, [popupHeight, rootFontSize, snapPoints, viewportHeight]);
  const resolvedActiveSnapPoint = React.useMemo(() => {
    if (activeSnapPoint === undefined) {
      return resolvedSnapPoints[0];
    }
    if (activeSnapPoint === null) {
      return undefined;
    }
    const exactMatch = resolvedSnapPoints.find(point => Object.is(point.value, activeSnapPoint));
    if (exactMatch) {
      return exactMatch;
    }
    const maxHeight = Math.min(popupHeight, viewportHeight);
    const resolvedHeight = resolveSnapPointValue(activeSnapPoint, viewportHeight, rootFontSize);
    if (resolvedHeight === null || !Number.isFinite(resolvedHeight)) {
      return undefined;
    }
    const clampedHeight = (0, _clamp.clamp)(resolvedHeight, 0, maxHeight);
    return findClosestSnapPoint(clampedHeight, resolvedSnapPoints) ?? undefined;
  }, [activeSnapPoint, popupHeight, resolvedSnapPoints, rootFontSize, viewportHeight]);
  return {
    snapPoints,
    activeSnapPoint,
    setActiveSnapPoint,
    popupHeight,
    viewportHeight,
    resolvedSnapPoints,
    activeSnapPointOffset: resolvedActiveSnapPoint?.offset ?? null
  };
}