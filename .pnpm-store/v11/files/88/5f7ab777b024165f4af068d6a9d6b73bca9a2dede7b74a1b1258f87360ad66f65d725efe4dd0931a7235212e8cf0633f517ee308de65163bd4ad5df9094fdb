"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.DrawerViewport = void 0;
var React = _interopRequireWildcard(require("react"));
var ReactDOM = _interopRequireWildcard(require("react-dom"));
var _dom = require("@floating-ui/utils/dom");
var _addEventListener = require("@base-ui/utils/addEventListener");
var _owner = require("@base-ui/utils/owner");
var _useAnimationFrame = require("@base-ui/utils/useAnimationFrame");
var _useStableCallback = require("@base-ui/utils/useStableCallback");
var _DialogRootContext = require("../../dialog/root/DialogRootContext");
var _DialogViewport = require("../../dialog/viewport/DialogViewport");
var _mergeProps = require("../../merge-props");
var _DrawerRootContext = require("../root/DrawerRootContext");
var _useDrawerSnapPoints = require("../root/useDrawerSnapPoints");
var _DrawerProviderContext = require("../provider/DrawerProviderContext");
var _clamp = require("../../internals/clamp");
var _useSwipeDismiss = require("../../utils/useSwipeDismiss");
var _DrawerPopupCssVars = require("../popup/DrawerPopupCssVars");
var _DrawerPopupDataAttributes = require("../popup/DrawerPopupDataAttributes");
var _DrawerBackdropCssVars = require("../backdrop/DrawerBackdropCssVars");
var _DrawerContentDataAttributes = require("../content/DrawerContentDataAttributes");
var _reasons = require("../../internals/reasons");
var _createBaseUIEventDetails = require("../../internals/createBaseUIEventDetails");
var _utils = require("../../floating-ui-react/utils");
var _DrawerViewportContext = require("./DrawerViewportContext");
var _stateAttributesMapping = require("../../internals/stateAttributesMapping");
var _scrollable = require("../../utils/scrollable");
var _constants = require("../../internals/constants");
var _getElementAtPoint = require("../../utils/getElementAtPoint");
var _DrawerVirtualKeyboardContext = require("../virtual-keyboard-provider/DrawerVirtualKeyboardContext");
var _jsxRuntime = require("react/jsx-runtime");
const MIN_SWIPE_THRESHOLD = 10;
const FAST_SWIPE_VELOCITY = 0.5;
const SNAP_VELOCITY_THRESHOLD = 0.5;
const SNAP_VELOCITY_MULTIPLIER = 300;
const MAX_SNAP_VELOCITY = 4;
const MIN_SWIPE_RELEASE_VELOCITY = 0.2;
const MAX_SWIPE_RELEASE_VELOCITY = 4;
const MIN_SWIPE_RELEASE_DURATION_MS = 80;
const MAX_SWIPE_RELEASE_DURATION_MS = 360;
const MIN_SWIPE_RELEASE_SCALAR = 0.1;
const MAX_SWIPE_RELEASE_SCALAR = 1;
const DRAWER_CONTENT_SELECTOR = `[${_DrawerContentDataAttributes.DRAWER_CONTENT_ATTRIBUTE}]`;
/**
 * A positioning container for the drawer popup that can be made scrollable.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Drawer](https://base-ui.com/react/components/drawer)
 */
const DrawerViewport = exports.DrawerViewport = /*#__PURE__*/React.forwardRef(function DrawerViewport(props, forwardedRef) {
  const {
    render,
    className,
    style,
    children,
    ...elementProps
  } = props;
  const {
    store
  } = (0, _DialogRootContext.useDialogRootContext)();
  const popupRef = store.context.popupRef;
  const backdropRef = store.context.backdropRef;
  const {
    swipeDirection,
    notifyParentSwipingChange,
    notifyParentSwipeProgressChange,
    frontmostHeight,
    snapToSequentialPoints
  } = (0, _DrawerRootContext.useDrawerRootContext)();
  const providerContext = (0, _DrawerProviderContext.useDrawerProviderContext)(true);
  const {
    snapPoints,
    resolvedSnapPoints,
    activeSnapPoint,
    activeSnapPointOffset,
    setActiveSnapPoint,
    popupHeight
  } = (0, _useDrawerSnapPoints.useDrawerSnapPoints)();
  const open = store.useState('open');
  const mounted = store.useState('mounted');
  const nested = store.useState('nested');
  const nestedOpenDrawerCount = store.useState('nestedOpenDrawerCount');
  const viewportElement = store.useState('viewportElement');
  const popupElementState = store.useState('popupElement');
  const visualStateStore = providerContext?.visualStateStore;
  const nestedDrawerOpen = nestedOpenDrawerCount > 0;
  const scrollAxis = swipeDirection === 'left' || swipeDirection === 'right' ? 'horizontal' : 'vertical';
  const isVerticalScrollAxis = scrollAxis === 'vertical';
  const crossScrollAxis = isVerticalScrollAxis ? 'horizontal' : 'vertical';
  const [swipeRelease, setSwipeRelease] = React.useState(null);
  const pendingSwipeCloseSnapPointRef = React.useRef(undefined);
  const resetSwipeRef = React.useRef(null);
  const controlledDismissFrame = (0, _useAnimationFrame.useAnimationFrame)();
  const swipingRef = React.useRef(false);
  const nestedSwipeActiveRef = React.useRef(false);
  const lastPointerTypeRef = React.useRef('');
  const ignoreNextTouchStartFromPenRef = React.useRef(false);
  const ignoreTouchSwipeRef = React.useRef(false);
  const touchScrollStateRef = React.useRef(null);
  const virtualKeyboard = (0, _DrawerVirtualKeyboardContext.useDrawerVirtualKeyboardContext)();
  const snapPointRange = React.useMemo(() => {
    if (!snapPoints || snapPoints.length < 2) {
      return null;
    }
    if (swipeDirection !== 'down' && swipeDirection !== 'up') {
      return null;
    }
    if (resolvedSnapPoints.length < 2) {
      return null;
    }
    const offsets = resolvedSnapPoints.map(point => point.offset).filter(offset => Number.isFinite(offset)).sort((a, b) => a - b);
    if (offsets.length < 2) {
      return null;
    }
    const minOffset = offsets[0];
    const nextOffset = offsets[1];
    const maxOffset = offsets[offsets.length - 1];
    let range = nextOffset - minOffset;
    if (!Number.isFinite(range) || range <= 0) {
      const fallbackRange = maxOffset - minOffset;
      if (!Number.isFinite(fallbackRange) || fallbackRange <= 0) {
        return null;
      }
      range = fallbackRange;
    }
    return {
      minOffset,
      range
    };
  }, [resolvedSnapPoints, snapPoints, swipeDirection]);
  const snapPointProgress = React.useMemo(() => {
    if (!snapPointRange || activeSnapPointOffset === null) {
      return null;
    }
    return (0, _clamp.clamp)((activeSnapPointOffset - snapPointRange.minOffset) / snapPointRange.range, 0, 1);
  }, [activeSnapPointOffset, snapPointRange]);
  const swipeDirections = React.useMemo(() => {
    if (snapPoints && snapPoints.length > 0 && (swipeDirection === 'down' || swipeDirection === 'up')) {
      return swipeDirection === 'down' ? ['down', 'up'] : ['up', 'down'];
    }
    return [swipeDirection];
  }, [snapPoints, swipeDirection]);
  const setSwipeDismissed = (0, _useStableCallback.useStableCallback)(dismissed => {
    setSwipeDismissedElements(popupRef.current, backdropRef.current, dismissed);
  });
  const clearSwipeRelease = (0, _useStableCallback.useStableCallback)(() => {
    setSwipeDismissed(false);
    popupRef.current?.removeAttribute(_stateAttributesMapping.TransitionStatusDataAttributes.endingStyle);
    setSwipeRelease(null);
  });
  const finishNestedSwipe = (0, _useStableCallback.useStableCallback)(() => {
    if (!nestedSwipeActiveRef.current) {
      return;
    }
    nestedSwipeActiveRef.current = false;
    notifyParentSwipingChange?.(false);
  });
  const applySwipeProgress = (0, _useStableCallback.useStableCallback)(({
    resolvedProgress,
    shouldTrackProgress,
    notifyParent
  }) => {
    const isActive = open && !nested && shouldTrackProgress;
    const swipeProgress = isActive ? resolvedProgress : 0;
    const nestedSwipeProgress = open && shouldTrackProgress ? resolvedProgress : 0;
    if (notifyParent && notifyParentSwipeProgressChange) {
      notifyParentSwipeProgressChange(nestedSwipeProgress);
      if (nestedSwipeProgress <= 0) {
        finishNestedSwipe();
      }
    }
    visualStateStore?.set({
      swipeProgress,
      frontmostHeight: swipeProgress > 0 ? frontmostHeight : 0
    });
    const backdropElement = backdropRef.current;
    if (!backdropElement) {
      return;
    }
    if (!isActive || swipeProgress <= 0) {
      backdropElement.style.setProperty(_DrawerBackdropCssVars.DrawerBackdropCssVars.swipeProgress, '0');
      backdropElement.style.removeProperty(_DrawerPopupCssVars.DrawerPopupCssVars.height);
      return;
    }
    backdropElement.style.setProperty(_DrawerBackdropCssVars.DrawerBackdropCssVars.swipeProgress, `${swipeProgress}`);
    if (frontmostHeight > 0) {
      backdropElement.style.setProperty(_DrawerPopupCssVars.DrawerPopupCssVars.height, `${frontmostHeight}px`);
    } else {
      backdropElement.style.removeProperty(_DrawerPopupCssVars.DrawerPopupCssVars.height);
    }
  });
  function resolveSwipeRelease({
    direction,
    deltaX,
    deltaY,
    velocityX,
    velocityY,
    releaseVelocityX,
    releaseVelocityY
  }) {
    if (!direction) {
      return null;
    }
    const popupElement = store.context.popupRef.current;
    if (!popupElement) {
      return null;
    }
    const size = direction === 'left' || direction === 'right' ? popupElement.offsetWidth : popupElement.offsetHeight;
    if (!Number.isFinite(size) || size <= 0) {
      return null;
    }
    const axisDelta = direction === 'left' || direction === 'right' ? deltaX : deltaY;
    const snapPointBaseOffset = snapPoints && snapPoints.length > 0 ? activeSnapPointOffset ?? 0 : 0;
    let baseOffset = 0;
    if (direction === 'down') {
      baseOffset = snapPointBaseOffset;
    } else if (direction === 'up') {
      baseOffset = -snapPointBaseOffset;
    }
    const translation = baseOffset + axisDelta;
    const translationAlongDirection = direction === 'left' || direction === 'up' ? -translation : translation;
    const remainingDistance = Math.max(0, size - translationAlongDirection);
    if (!Number.isFinite(remainingDistance) || remainingDistance <= 0) {
      return null;
    }
    const axisVelocity = direction === 'left' || direction === 'right' ? releaseVelocityX : releaseVelocityY;
    const fallbackVelocity = direction === 'left' || direction === 'right' ? velocityX : velocityY;
    const resolvedVelocity = Math.abs(axisVelocity) > 0 && Number.isFinite(axisVelocity) ? axisVelocity : fallbackVelocity;
    const directionalVelocity = direction === 'left' || direction === 'up' ? -resolvedVelocity : resolvedVelocity;
    if (!Number.isFinite(directionalVelocity) || directionalVelocity <= MIN_SWIPE_RELEASE_VELOCITY) {
      return null;
    }
    const clampedVelocity = (0, _clamp.clamp)(directionalVelocity, MIN_SWIPE_RELEASE_VELOCITY, MAX_SWIPE_RELEASE_VELOCITY);
    const durationMs = (0, _clamp.clamp)(remainingDistance / clampedVelocity, MIN_SWIPE_RELEASE_DURATION_MS, MAX_SWIPE_RELEASE_DURATION_MS);
    if (!Number.isFinite(durationMs)) {
      return null;
    }
    const normalizedDuration = (durationMs - MIN_SWIPE_RELEASE_DURATION_MS) / (MAX_SWIPE_RELEASE_DURATION_MS - MIN_SWIPE_RELEASE_DURATION_MS);
    const durationScalar = (0, _clamp.clamp)(MIN_SWIPE_RELEASE_SCALAR + normalizedDuration * (MAX_SWIPE_RELEASE_SCALAR - MIN_SWIPE_RELEASE_SCALAR), MIN_SWIPE_RELEASE_SCALAR, MAX_SWIPE_RELEASE_SCALAR);
    if (!Number.isFinite(durationScalar) || durationScalar <= 0) {
      return null;
    }
    return durationScalar;
  }
  function updateNestedSwipeActive(details) {
    if (nestedSwipeActiveRef.current || !details) {
      return;
    }
    const direction = details.direction ?? swipeDirection;
    const delta = direction === 'left' || direction === 'right' ? details.deltaX : details.deltaY;
    if (!Number.isFinite(delta) || Math.abs(delta) < MIN_SWIPE_THRESHOLD) {
      return;
    }
    nestedSwipeActiveRef.current = true;
    notifyParentSwipingChange?.(true);
  }
  const swipe = (0, _useSwipeDismiss.useSwipeDismiss)({
    enabled: mounted && !nestedDrawerOpen,
    directions: swipeDirections,
    elementRef: store.context.popupRef,
    ignoreSelectorWhenTouch: false,
    ignoreScrollableAncestors: true,
    movementCssVars: {
      x: _DrawerPopupCssVars.DrawerPopupCssVars.swipeMovementX,
      y: _DrawerPopupCssVars.DrawerPopupCssVars.swipeMovementY
    },
    onSwipeStart(event) {
      if ('touches' in event || 'pointerType' in event && event.pointerType === 'touch') {
        return;
      }
      const popupElement = popupRef.current;
      if (!popupElement) {
        return;
      }
      const doc = (0, _owner.ownerDocument)(popupElement);
      const selection = doc.getSelection?.();
      if (!selection || selection.isCollapsed) {
        return;
      }
      const anchorElement = (0, _dom.isElement)(selection.anchorNode) ? selection.anchorNode : selection.anchorNode?.parentElement;
      const focusElement = (0, _dom.isElement)(selection.focusNode) ? selection.focusNode : selection.focusNode?.parentElement;
      if (!(0, _utils.contains)(popupElement, anchorElement) && !(0, _utils.contains)(popupElement, focusElement)) {
        return;
      }
      selection.removeAllRanges();
    },
    onSwipingChange(swiping) {
      swipingRef.current = swiping;
      setBackdropSwipingAttribute(store.context.backdropRef.current, swiping);
      if (!swiping && !notifyParentSwipeProgressChange) {
        finishNestedSwipe();
      }
    },
    swipeThreshold({
      element,
      direction
    }) {
      return getBaseSwipeThreshold(element, direction);
    },
    canStart(position, details) {
      const popupElement = store.context.popupRef.current;
      if (!popupElement) {
        return false;
      }
      const doc = popupElement.ownerDocument;
      const elementAtPoint = (0, _getElementAtPoint.getElementAtPoint)(doc, position.x, position.y);
      if (!elementAtPoint || !(0, _utils.contains)(popupElement, elementAtPoint)) {
        return false;
      }
      const nativeEvent = details.nativeEvent;
      const touchLike = 'touches' in nativeEvent || 'pointerType' in nativeEvent && nativeEvent.pointerType === 'touch';
      if (touchLike && shouldIgnoreSwipeForTextSelection(doc, popupElement)) {
        return false;
      }
      if (nativeEvent.type === 'touchstart' && isSwipeIgnoredTarget(elementAtPoint)) {
        return false;
      }
      return true;
    },
    onProgress(progress, details) {
      updateNestedSwipeActive(details);
      const hasSnapPoints = Boolean(snapPoints && snapPoints.length > 0);
      if (swipingRef.current && swipeDirection === 'down' && hasSnapPoints && details && Number.isFinite(details.deltaY)) {
        const popupElement = store.context.popupRef.current;
        if (popupElement) {
          popupElement.style.removeProperty('transform');
          popupElement.style.setProperty(_DrawerPopupCssVars.DrawerPopupCssVars.swipeMovementY, `${(0, _useDrawerSnapPoints.getSnapPointSwipeMovement)(activeSnapPointOffset ?? 0, details.deltaY)}px`);
        }
      }
      const currentDirection = details?.direction ?? swipe.swipeDirection;
      const isDismissSwipe = currentDirection === undefined || currentDirection === swipeDirection;
      const isVerticalSwipe = swipeDirection === 'down' || swipeDirection === 'up';
      const shouldTrackProgress = hasSnapPoints && isVerticalSwipe || !hasSnapPoints || swipeDirection === 'left' || swipeDirection === 'right' || isDismissSwipe;
      let resolvedProgress = progress;
      if (snapPointRange && popupHeight > 0) {
        if (details && Number.isFinite(details.deltaY)) {
          const baseOffset = activeSnapPointOffset ?? snapPointRange.minOffset;
          const nextOffset = (0, _clamp.clamp)(baseOffset + details.deltaY, 0, popupHeight);
          resolvedProgress = (0, _clamp.clamp)((nextOffset - snapPointRange.minOffset) / snapPointRange.range, 0, 1);
        } else if (snapPointProgress !== null) {
          resolvedProgress = snapPointProgress;
        } else if (currentDirection === 'down' || currentDirection === 'up') {
          const displacement = progress * popupHeight;
          const baseOffset = activeSnapPointOffset ?? snapPointRange.minOffset;
          const nextOffset = currentDirection === 'down' ? baseOffset + displacement : baseOffset - displacement;
          resolvedProgress = (0, _clamp.clamp)((nextOffset - snapPointRange.minOffset) / snapPointRange.range, 0, 1);
        }
      }
      applySwipeProgress({
        resolvedProgress,
        shouldTrackProgress,
        notifyParent: true
      });
    },
    onRelease({
      event,
      deltaX,
      deltaY,
      direction,
      velocityX,
      velocityY,
      releaseVelocityX,
      releaseVelocityY
    }) {
      const swipeReleasePayload = {
        deltaX,
        deltaY,
        velocityX,
        velocityY,
        releaseVelocityX,
        releaseVelocityY
      };
      function startSwipeRelease(resolvedDirection) {
        // Start ending transition styles earlier and synchronously to prevent a period where
        // the popup appears stuck on release before the actual closing animation starts.
        const popupElement = store.context.popupRef.current;
        if (!popupElement) {
          return;
        }
        finishNestedSwipe();
        setSwipeDismissed(true);
        popupElement.style.removeProperty('transition');
        popupElement.setAttribute(_stateAttributesMapping.TransitionStatusDataAttributes.endingStyle, '');
        ReactDOM.flushSync(() => {
          setSwipeRelease(resolveSwipeRelease({
            direction: resolvedDirection,
            ...swipeReleasePayload
          }));
        });
      }
      if (!snapPoints || snapPoints.length === 0) {
        if (!direction) {
          clearSwipeRelease();
          return undefined;
        }
        const element = store.context.popupRef.current;
        if (!element) {
          clearSwipeRelease();
          return undefined;
        }
        const baseThreshold = getBaseSwipeThreshold(element, direction);
        const delta = direction === 'left' || direction === 'right' ? deltaX : deltaY;
        if (!Number.isFinite(delta)) {
          clearSwipeRelease();
          return undefined;
        }
        const directionalDelta = direction === 'left' || direction === 'up' ? -delta : delta;
        if (directionalDelta <= 0) {
          clearSwipeRelease();
          return false;
        }
        const velocity = direction === 'left' || direction === 'right' ? velocityX : velocityY;
        const directionalVelocity = direction === 'left' || direction === 'up' ? -velocity : velocity;
        if (directionalVelocity >= FAST_SWIPE_VELOCITY && directionalDelta > 0) {
          startSwipeRelease(direction);
          return true;
        }
        const shouldClose = directionalDelta > baseThreshold;
        if (shouldClose) {
          startSwipeRelease(direction);
        } else {
          clearSwipeRelease();
        }
        return shouldClose;
      }
      if (swipeDirection !== 'down' && swipeDirection !== 'up') {
        clearSwipeRelease();
        return undefined;
      }
      if (!popupHeight || resolvedSnapPoints.length === 0) {
        clearSwipeRelease();
        return undefined;
      }
      const dragDelta = swipeDirection === 'down' ? deltaY : -deltaY;
      if (!Number.isFinite(dragDelta)) {
        clearSwipeRelease();
        return undefined;
      }
      const dragDirection = Math.sign(dragDelta);
      const releaseDirectionalVelocity = swipeDirection === 'down' ? releaseVelocityY : -releaseVelocityY;
      const fallbackDirectionalVelocity = swipeDirection === 'down' ? velocityY : -velocityY;
      let resolvedDirectionalVelocity = Number.isFinite(releaseDirectionalVelocity) ? releaseDirectionalVelocity : fallbackDirectionalVelocity;
      if (dragDirection !== 0 && Math.abs(dragDelta) >= MIN_SWIPE_THRESHOLD && Number.isFinite(resolvedDirectionalVelocity)) {
        const velocityDirection = Math.sign(resolvedDirectionalVelocity);
        if (velocityDirection !== 0 && velocityDirection !== dragDirection) {
          // Ignore touch reversals that would otherwise flip the snap decision.
          resolvedDirectionalVelocity = fallbackDirectionalVelocity;
        }
      }
      const currentOffset = activeSnapPointOffset ?? 0;
      const dragTargetOffset = (0, _clamp.clamp)(currentOffset + dragDelta, 0, popupHeight);
      const velocityOffset = Number.isFinite(resolvedDirectionalVelocity) && Math.abs(resolvedDirectionalVelocity) >= SNAP_VELOCITY_THRESHOLD ? (0, _clamp.clamp)(resolvedDirectionalVelocity, -MAX_SNAP_VELOCITY, MAX_SNAP_VELOCITY) * SNAP_VELOCITY_MULTIPLIER : 0;
      const targetOffset = snapToSequentialPoints ? dragTargetOffset : (0, _clamp.clamp)(dragTargetOffset + velocityOffset, 0, popupHeight);
      const snapPointEventDetails = (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.swipe, event);
      const closeFromSnapPoints = () => {
        pendingSwipeCloseSnapPointRef.current = activeSnapPoint;
        setActiveSnapPoint?.(null, snapPointEventDetails);
        startSwipeRelease(swipeDirection);
        return true;
      };
      if (snapToSequentialPoints) {
        const orderedSnapPoints = [...resolvedSnapPoints].sort((first, second) => first.offset - second.offset);
        if (orderedSnapPoints.length === 0) {
          clearSwipeRelease();
          return false;
        }
        let currentIndex = 0;
        let closestDistance = Math.abs(currentOffset - orderedSnapPoints[0].offset);
        for (let index = 1; index < orderedSnapPoints.length; index += 1) {
          const distance = Math.abs(currentOffset - orderedSnapPoints[index].offset);
          if (distance < closestDistance) {
            closestDistance = distance;
            currentIndex = index;
          }
        }
        let targetSnapPoint = orderedSnapPoints[0];
        closestDistance = Math.abs(targetOffset - targetSnapPoint.offset);
        for (const snapPoint of orderedSnapPoints) {
          const distance = Math.abs(targetOffset - snapPoint.offset);
          if (distance < closestDistance) {
            closestDistance = distance;
            targetSnapPoint = snapPoint;
          }
        }
        const velocityDirection = Math.sign(resolvedDirectionalVelocity);
        const shouldAdvance = dragDirection !== 0 && velocityDirection !== 0 && velocityDirection === dragDirection && Math.abs(resolvedDirectionalVelocity) >= SNAP_VELOCITY_THRESHOLD;
        let effectiveTargetOffset = targetOffset;
        if (shouldAdvance) {
          const adjacentIndex = (0, _clamp.clamp)(currentIndex + dragDirection, 0, orderedSnapPoints.length - 1);
          if (adjacentIndex !== currentIndex) {
            const adjacentPoint = orderedSnapPoints[adjacentIndex];
            const shouldForceAdjacent = dragDirection > 0 ? targetOffset < adjacentPoint.offset : targetOffset > adjacentPoint.offset;
            if (shouldForceAdjacent) {
              targetSnapPoint = adjacentPoint;
              effectiveTargetOffset = adjacentPoint.offset;
            }
          } else if (dragDirection > 0) {
            return closeFromSnapPoints();
          }
        }
        const closeOffset = popupHeight;
        const closeDistance = Math.abs(effectiveTargetOffset - closeOffset);
        const snapDistance = Math.abs(effectiveTargetOffset - targetSnapPoint.offset);
        if (closeDistance < snapDistance) {
          return closeFromSnapPoints();
        }
        setActiveSnapPoint?.(targetSnapPoint.value, snapPointEventDetails);
        clearSwipeRelease();
        return false;
      }
      if (resolvedDirectionalVelocity >= FAST_SWIPE_VELOCITY && dragDelta > 0) {
        return closeFromSnapPoints();
      }
      let closestSnapPoint = resolvedSnapPoints[0];
      let closestDistance = Math.abs(targetOffset - closestSnapPoint.offset);
      for (const snapPoint of resolvedSnapPoints) {
        const distance = Math.abs(targetOffset - snapPoint.offset);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestSnapPoint = snapPoint;
        }
      }
      const closeOffset = popupHeight;
      const closeDistance = Math.abs(targetOffset - closeOffset);
      if (closeDistance < closestDistance) {
        return closeFromSnapPoints();
      }
      setActiveSnapPoint?.(closestSnapPoint.value, snapPointEventDetails);
      clearSwipeRelease();
      return false;
    },
    onDismiss(event) {
      visualStateStore?.set({
        swipeProgress: 0,
        frontmostHeight: 0
      });
      const backdropElement = store.context.backdropRef.current;
      if (backdropElement) {
        backdropElement.style.setProperty(_DrawerBackdropCssVars.DrawerBackdropCssVars.swipeProgress, '0');
        backdropElement.style.removeProperty(_DrawerPopupCssVars.DrawerPopupCssVars.height);
      }
      const dismissEventDetails = (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.swipe, event);
      store.setOpen(false, dismissEventDetails);
      if (dismissEventDetails.isCanceled) {
        const pendingSnapPoint = pendingSwipeCloseSnapPointRef.current;
        if (pendingSnapPoint !== undefined) {
          setActiveSnapPoint?.(pendingSnapPoint, (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.swipe, event));
        }
        pendingSwipeCloseSnapPointRef.current = undefined;
        resetSwipeRef.current?.();
        clearSwipeRelease();
        return;
      }

      // In controlled mode, the effective open state may not have changed yet
      // (openProp takes precedence over state.open). Proceed optimistically with the
      // dismiss animation — React's Scheduler flushes before the next rAF, so we can
      // reliably check whether the parent accepted or rejected the close.
      // Note: if onOpenChange is asynchronous (e.g., closes the drawer after a network
      // call), the rAF check will see open === true, revert the animation, and the
      // drawer will close without animation when the parent eventually sets open={false}.
      if (store.select('open')) {
        const savedEvent = event;
        controlledDismissFrame.request(() => {
          if (store.select('open')) {
            // Parent rejected: revert animation and restore snap point.
            const pendingSnapPoint = pendingSwipeCloseSnapPointRef.current;
            if (pendingSnapPoint !== undefined) {
              setActiveSnapPoint?.(pendingSnapPoint, (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.swipe, savedEvent));
            }
            pendingSwipeCloseSnapPointRef.current = undefined;
            clearSwipeRelease();
            resetSwipeRef.current?.();
          } else {
            // Parent accepted: clean up the ref.
            pendingSwipeCloseSnapPointRef.current = undefined;
          }
        });
        return;
      }
      pendingSwipeCloseSnapPointRef.current = undefined;
      setSwipeDismissed(true);
    }
  });
  const swipePointerProps = swipe.getPointerProps();
  const swipeTouchProps = swipe.getTouchProps();
  const {
    moveNative: moveSwipeNative,
    reset: resetSwipe
  } = swipe;
  resetSwipeRef.current = resetSwipe;
  React.useEffect(() => {
    const rootElement = viewportElement ?? popupElementState;
    if (!rootElement) {
      return undefined;
    }
    const resolvedRootElement = rootElement;
    const doc = (0, _owner.ownerDocument)(resolvedRootElement);
    const win = (0, _owner.ownerWindow)(doc);
    function handleNativeTouchMove(event) {
      // The virtual keyboard provider observes the move to tell a tap apart from a drag.
      // It must run even when the swipe gesture below claims the event with
      // `stopPropagation()`, which would otherwise prevent React's delegated handlers
      // (and the provider) from ever seeing the move.
      virtualKeyboard?.onTouchMove(event);
      if (ignoreTouchSwipeRef.current) {
        return;
      }
      const touchState = touchScrollStateRef.current;
      const touch = event.touches[0];
      if (!touch || !touchState) {
        return;
      }
      const drawerAxisDelta = isVerticalScrollAxis ? touch.clientY - touchState.lastY : touch.clientX - touchState.lastX;

      // Preserve native range interaction by never locking touchmove for range inputs.
      if (isEventOnRangeInput(event, win)) {
        touchState.allowSwipe = false;
        updateTouchScrollPosition(touchState, touch);
        return;
      }

      // Avoid blocking pinch zoom or text selection adjustments on iOS Safari.
      if (event.touches.length === 2) {
        updateTouchScrollPosition(touchState, touch);
        return;
      }
      const allowTouchMove = shouldIgnoreSwipeForTextSelection(doc, resolvedRootElement);
      if (allowTouchMove || !open || !mounted || nestedDrawerOpen) {
        updateTouchScrollPosition(touchState, touch);
        return;
      }
      if (preserveNativeCrossAxisScrollOnMove(touchState, touch, isVerticalScrollAxis)) {
        updateTouchScrollPosition(touchState, touch);
        return;
      }
      const scrollTarget = touchState.scrollTarget;
      if (!scrollTarget || scrollTarget === doc.documentElement || scrollTarget === doc.body) {
        if (event.cancelable) {
          event.preventDefault();
        }
        // Claim the gesture before React's delegated touch handlers see it; dispatching the
        // move through React re-rasterizes the popup content on every frame.
        event.stopPropagation();
        moveSwipeNative(event, resolvedRootElement);
        updateTouchScrollPosition(touchState, touch);
        return;
      }
      const hasScrollableContent = hasScrollableContentOnAxis(scrollTarget, scrollAxis);
      if (!hasScrollableContent) {
        // If the scroll container doesn't overflow on the drawer axis, prevent the window from
        // scrolling instead.
        if (event.cancelable) {
          event.preventDefault();
        }
        event.stopPropagation();
        updateTouchScrollPosition(touchState, touch);
        return;
      }
      const delta = drawerAxisDelta;
      if (delta !== 0) {
        const canSwipeFromScrollEdge = canSwipeFromScrollEdgeOnMove(scrollTarget, scrollAxis, swipeDirection, delta);
        if (!touchState.allowSwipe) {
          if (!event.cancelable) {
            touchState.allowSwipe = false;
          } else if (canSwipeFromScrollEdge) {
            touchState.allowSwipe = true;
            event.preventDefault();
          } else {
            touchState.allowSwipe = false;
          }
        } else if (event.cancelable) {
          event.preventDefault();
        }
      }
      if (touchState.allowSwipe === true) {
        event.stopPropagation();
        moveSwipeNative(event, resolvedRootElement);
      }
      updateTouchScrollPosition(touchState, touch);
    }
    return (0, _addEventListener.addEventListener)(doc, 'touchmove', handleNativeTouchMove, {
      passive: false,
      capture: true
    });
  }, [mounted, nestedDrawerOpen, open, popupElementState, isVerticalScrollAxis, scrollAxis, swipeDirection, moveSwipeNative, viewportElement, virtualKeyboard]);
  React.useEffect(() => {
    if (!snapPointRange || swipe.swiping) {
      return;
    }
    const resolvedProgress = !open || nested ? 0 : snapPointProgress ?? 0;
    applySwipeProgress({
      resolvedProgress,
      shouldTrackProgress: true,
      notifyParent: false
    });
  }, [applySwipeProgress, frontmostHeight, nested, notifyParentSwipeProgressChange, open, snapPointProgress, snapPointRange, swipe.swiping, store, visualStateStore]);
  React.useEffect(() => {
    if (!notifyParentSwipeProgressChange) {
      return undefined;
    }
    if (!open) {
      notifyParentSwipeProgressChange(0);
    }
    return () => {
      notifyParentSwipeProgressChange(0);
    };
  }, [notifyParentSwipeProgressChange, open]);
  React.useEffect(() => {
    if (open) {
      resetSwipe();
      clearSwipeRelease();
    }
  }, [clearSwipeRelease, open, resetSwipe]);
  React.useEffect(() => {
    const backdropElement = backdropRef.current;
    return () => {
      visualStateStore?.set({
        swipeProgress: 0,
        frontmostHeight: 0
      });
      setBackdropSwipingAttribute(backdropElement, false);
      // `data-swiping` is set on whichever backdrop is current when a swipe starts, which can
      // differ from the captured element if the backdrop mounted late or changed identity.
      // Reading the live ref here is intentional so the current backdrop is cleared too.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const currentBackdrop = backdropRef.current;
      if (currentBackdrop !== backdropElement) {
        setBackdropSwipingAttribute(currentBackdrop, false);
      }
      finishNestedSwipe();
    };
  }, [backdropRef, finishNestedSwipe, visualStateStore]);
  const swipeProviderValue = React.useMemo(() => ({
    swiping: swipe.swiping,
    getDragStyles: swipe.getDragStyles,
    swipeStrength: swipeRelease ?? null,
    setSwipeDismissed
  }), [setSwipeDismissed, swipe.getDragStyles, swipe.swiping, swipeRelease]);
  function resetTouchTrackingState() {
    ignoreTouchSwipeRef.current = false;
    touchScrollStateRef.current = null;
    lastPointerTypeRef.current = '';
    ignoreNextTouchStartFromPenRef.current = false;
  }
  return /*#__PURE__*/(0, _jsxRuntime.jsx)(_DialogViewport.DialogViewport, {
    ref: forwardedRef,
    className: className,
    style: style,
    render: render,
    ...(0, _mergeProps.mergeProps)(elementProps, {
      onPointerDown(event) {
        lastPointerTypeRef.current = event.pointerType;
        ignoreNextTouchStartFromPenRef.current = event.pointerType === 'pen';
        if (!open || !mounted || nestedDrawerOpen) {
          return;
        }
        const doc = (0, _owner.ownerDocument)(event.currentTarget);
        const elementAtPoint = (0, _getElementAtPoint.getElementAtPoint)(doc, event.clientX, event.clientY);
        if (isSwipeIgnoredTarget(elementAtPoint) || isDrawerContentTarget(elementAtPoint)) {
          return;
        }
        if (event.pointerType === 'touch') {
          return;
        }
        swipePointerProps.onPointerDown?.(event);
      },
      onPointerMove(event) {
        if (event.pointerType === 'touch') {
          return;
        }
        swipePointerProps.onPointerMove?.(event);
      },
      onPointerUp(event) {
        if (lastPointerTypeRef.current === event.pointerType) {
          lastPointerTypeRef.current = '';
        }
        if (event.pointerType === 'touch') {
          return;
        }
        swipePointerProps.onPointerUp?.(event);
      },
      onPointerCancel(event) {
        if (lastPointerTypeRef.current === event.pointerType) {
          lastPointerTypeRef.current = '';
        }
        if (event.pointerType === 'touch') {
          return;
        }
        swipePointerProps.onPointerCancel?.(event);
      },
      onTouchStart(event) {
        const startedFromPenPointerDown = lastPointerTypeRef.current === 'pen' && ignoreNextTouchStartFromPenRef.current;
        if (startedFromPenPointerDown) {
          ignoreNextTouchStartFromPenRef.current = false;
          ignoreTouchSwipeRef.current = false;
          touchScrollStateRef.current = null;
          return;
        }
        if (!open || !mounted || nestedDrawerOpen) {
          ignoreTouchSwipeRef.current = false;
          touchScrollStateRef.current = null;
          return;
        }
        const touch = event.touches[0];
        if (!touch) {
          return;
        }
        if (isReactTouchEventOnRangeInput(event)) {
          ignoreTouchSwipeRef.current = false;
          touchScrollStateRef.current = null;
          return;
        }
        const doc = (0, _owner.ownerDocument)(event.currentTarget);
        const elementAtPoint = (0, _getElementAtPoint.getElementAtPoint)(doc, touch.clientX, touch.clientY);
        const rootElement = viewportElement ?? popupElementState;
        const eventTarget = (0, _utils.getTarget)(event.nativeEvent);
        const target = (0, _dom.isElement)(eventTarget) ? eventTarget : null;
        if (rootElement && target && !(0, _utils.contains)(rootElement, target)) {
          ignoreTouchSwipeRef.current = true;
          touchScrollStateRef.current = null;
          return;
        }
        virtualKeyboard?.onTouchStart(event);
        ignoreTouchSwipeRef.current = isSwipeIgnoredTarget(elementAtPoint);
        if (ignoreTouchSwipeRef.current) {
          touchScrollStateRef.current = null;
          return;
        }
        let scrollTarget = null;
        let hasCrossAxisScrollableContent = false;
        if (rootElement && target) {
          scrollTarget = (0, _scrollable.findScrollableTouchTarget)(target, rootElement, scrollAxis);
          hasCrossAxisScrollableContent = (0, _scrollable.findScrollableTouchTarget)(target, rootElement, crossScrollAxis) != null;
        }
        let allowSwipe = null;
        if (scrollTarget) {
          const canSwipeFromEdge = isAtSwipeStartEdge(scrollTarget, scrollAxis, swipeDirection);
          allowSwipe = canSwipeFromEdge ? null : false;
        }
        touchScrollStateRef.current = {
          startX: touch.clientX,
          startY: touch.clientY,
          lastX: touch.clientX,
          lastY: touch.clientY,
          scrollTarget,
          hasCrossAxisScrollableContent,
          allowSwipe,
          preserveNativeCrossAxisScroll: false
        };
        swipeTouchProps.onTouchStart?.(event);
      },
      onTouchEnd(event) {
        virtualKeyboard?.onTouchEnd(event);
        resetTouchTrackingState();
        swipeTouchProps.onTouchEnd?.(event);
      },
      onTouchCancel(event) {
        virtualKeyboard?.onTouchCancel();
        resetTouchTrackingState();
        swipeTouchProps.onTouchCancel?.(event);
      },
      // Drawer popups use drawer-specific nested state attributes.
      // Suppress DialogViewport's generic nested dialog attribute.
      ['data-nested-dialog-open']: undefined
    }),
    children: /*#__PURE__*/(0, _jsxRuntime.jsx)(_DrawerViewportContext.DrawerViewportContext.Provider, {
      value: swipeProviderValue,
      children: children
    })
  });
});
if (process.env.NODE_ENV !== "production") DrawerViewport.displayName = "DrawerViewport";
function setSwipeDismissedElements(popupElement, backdropElement, dismissed) {
  if (dismissed) {
    popupElement?.setAttribute(_DrawerPopupDataAttributes.DrawerPopupDataAttributes.swipeDismiss, '');
    backdropElement?.setAttribute(_DrawerPopupDataAttributes.DrawerPopupDataAttributes.swipeDismiss, '');
    return;
  }
  popupElement?.removeAttribute(_DrawerPopupDataAttributes.DrawerPopupDataAttributes.swipeDismiss);
  backdropElement?.removeAttribute(_DrawerPopupDataAttributes.DrawerPopupDataAttributes.swipeDismiss);
}
function setBackdropSwipingAttribute(backdropElement, swiping) {
  if (!backdropElement) {
    return;
  }
  if (swiping) {
    backdropElement.setAttribute(_DrawerPopupDataAttributes.DrawerPopupDataAttributes.swiping, '');
    return;
  }
  backdropElement.removeAttribute(_DrawerPopupDataAttributes.DrawerPopupDataAttributes.swiping);
}
function isSwipeIgnoredTarget(target) {
  return Boolean(target?.closest(_constants.BASE_UI_SWIPE_IGNORE_SELECTOR));
}
function isDrawerContentTarget(target) {
  return Boolean(target?.closest(DRAWER_CONTENT_SELECTOR));
}
function getBaseSwipeThreshold(element, direction) {
  const size = direction === 'left' || direction === 'right' ? element.offsetWidth : element.offsetHeight;
  return Math.max(size * 0.5, MIN_SWIPE_THRESHOLD);
}
function isRangeInput(target, win) {
  return target instanceof win.HTMLInputElement && target.type === 'range';
}
function isTextSelectionControl(target) {
  if (!(0, _dom.isElement)(target)) {
    return false;
  }
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
}
function hasExpandedSelectionWithinTarget(selection, target) {
  const anchorElement = (0, _dom.isElement)(selection.anchorNode) ? selection.anchorNode : selection.anchorNode?.parentElement;
  const focusElement = (0, _dom.isElement)(selection.focusNode) ? selection.focusNode : selection.focusNode?.parentElement;
  return selection.containsNode(target, true) || (0, _utils.contains)(target, anchorElement) || (0, _utils.contains)(target, focusElement);
}
function shouldIgnoreSwipeForTextSelection(doc, rootElement) {
  const activeEl = (0, _utils.activeElement)(doc);
  const activeElementWithinRoot = Boolean(activeEl && (0, _utils.contains)(rootElement, activeEl));
  if (activeElementWithinRoot && isTextSelectionControl(activeEl)) {
    const {
      selectionStart,
      selectionEnd
    } = activeEl;
    if (selectionStart != null && selectionEnd != null && selectionStart < selectionEnd) {
      return true;
    }
  }
  const selection = doc.getSelection?.();
  if (!selection || selection.isCollapsed) {
    return false;
  }
  return hasExpandedSelectionWithinTarget(selection, rootElement);
}
function isEventOnRangeInput(event, win) {
  const composedPath = event.composedPath();
  if (composedPath) {
    return composedPath.some(pathTarget => isRangeInput(pathTarget, win));
  }
  return isRangeInput((0, _utils.getTarget)(event), win);
}
function isReactTouchEventOnRangeInput(event) {
  return isEventOnRangeInput(event.nativeEvent, (0, _owner.ownerWindow)(event.currentTarget));
}
function updateTouchScrollPosition(touchState, touch) {
  touchState.lastX = touch.clientX;
  touchState.lastY = touch.clientY;
}
function preserveNativeCrossAxisScrollOnMove(touchState, touch, isVerticalScrollAxis) {
  if (touchState.preserveNativeCrossAxisScroll) {
    return true;
  }
  if (touchState.allowSwipe === true || !touchState.hasCrossAxisScrollableContent) {
    return false;
  }
  const drawerAxisGestureDelta = isVerticalScrollAxis ? touch.clientY - touchState.startY : touch.clientX - touchState.startX;
  const crossAxisGestureDelta = isVerticalScrollAxis ? touch.clientX - touchState.startX : touch.clientY - touchState.startY;
  const absDrawerAxisGestureDelta = Math.abs(drawerAxisGestureDelta);
  const absCrossAxisGestureDelta = Math.abs(crossAxisGestureDelta);
  if (absCrossAxisGestureDelta < 6 || absCrossAxisGestureDelta <= absDrawerAxisGestureDelta + 2) {
    return false;
  }
  touchState.preserveNativeCrossAxisScroll = true;
  return true;
}
function hasScrollableContentOnAxis(scrollTarget, axis) {
  return axis === 'vertical' ? scrollTarget.scrollHeight > scrollTarget.clientHeight : scrollTarget.scrollWidth > scrollTarget.clientWidth;
}
function getScrollMetrics(scrollTarget, axis) {
  if (axis === 'vertical') {
    const max = Math.max(0, scrollTarget.scrollHeight - scrollTarget.clientHeight);
    return {
      offset: scrollTarget.scrollTop,
      max
    };
  }
  const max = Math.max(0, scrollTarget.scrollWidth - scrollTarget.clientWidth);
  return {
    offset: scrollTarget.scrollLeft,
    max
  };
}
function isAtSwipeStartEdge(scrollTarget, axis, direction) {
  const {
    offset,
    max
  } = getScrollMetrics(scrollTarget, axis);
  const dismissFromStartEdge = shouldDismissFromStartEdge(direction, axis);
  if (dismissFromStartEdge === null) {
    return false;
  }
  return dismissFromStartEdge ? offset <= 0 : offset >= max;
}
function canSwipeFromScrollEdgeOnMove(scrollTarget, axis, direction, delta) {
  const {
    offset,
    max
  } = getScrollMetrics(scrollTarget, axis);
  const dismissFromStartEdge = shouldDismissFromStartEdge(direction, axis);
  if (dismissFromStartEdge === null) {
    return false;
  }
  const movingTowardDismiss = dismissFromStartEdge ? delta > 0 : delta < 0;
  if (!movingTowardDismiss) {
    return false;
  }
  return dismissFromStartEdge ? offset <= 0 : offset >= max;
}
function shouldDismissFromStartEdge(direction, axis) {
  if (axis === 'vertical') {
    if (direction === 'down') {
      return true;
    }
    if (direction === 'up') {
      return false;
    }
    return null;
  }
  if (direction === 'right') {
    return true;
  }
  if (direction === 'left') {
    return false;
  }
  return null;
}