"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.DrawerSwipeArea = void 0;
var React = _interopRequireWildcard(require("react"));
var _useStableCallback = require("@base-ui/utils/useStableCallback");
var _useTimeout = require("@base-ui/utils/useTimeout");
var _DialogRootContext = require("../../dialog/root/DialogRootContext");
var _useRenderElement = require("../../internals/useRenderElement");
var _createBaseUIEventDetails = require("../../internals/createBaseUIEventDetails");
var _reasons = require("../../internals/reasons");
var _useSwipeDismiss = require("../../utils/useSwipeDismiss");
var _DrawerPopupCssVars = require("../popup/DrawerPopupCssVars");
var _DrawerPopupDataAttributes = require("../popup/DrawerPopupDataAttributes");
var _DrawerBackdropCssVars = require("../backdrop/DrawerBackdropCssVars");
var _DrawerRootContext = require("../root/DrawerRootContext");
var _useBaseUiId = require("../../internals/useBaseUiId");
var _popups = require("../../utils/popups");
var _DrawerProviderContext = require("../provider/DrawerProviderContext");
var _DrawerSwipeAreaDataAttributes = require("./DrawerSwipeAreaDataAttributes");
const DEFAULT_SWIPE_OPEN_RATIO = 0.5;
const MIN_SWIPE_START_DISTANCE = 1;
const VELOCITY_THRESHOLD = 0.1;
const FALLBACK_SWIPE_OPEN_THRESHOLD = 40;
const SWIPE_AREA_OPEN_HOOK = {
  [_DrawerSwipeAreaDataAttributes.DrawerSwipeAreaDataAttributes.open]: ''
};
const SWIPE_AREA_CLOSED_HOOK = {
  [_DrawerSwipeAreaDataAttributes.DrawerSwipeAreaDataAttributes.closed]: ''
};
const SWIPE_AREA_SWIPING_HOOK = {
  [_DrawerSwipeAreaDataAttributes.DrawerSwipeAreaDataAttributes.swiping]: ''
};
const SWIPE_AREA_DISABLED_HOOK = {
  [_DrawerSwipeAreaDataAttributes.DrawerSwipeAreaDataAttributes.disabled]: ''
};
const stateAttributesMapping = {
  open(value) {
    return value ? SWIPE_AREA_OPEN_HOOK : SWIPE_AREA_CLOSED_HOOK;
  },
  swiping(value) {
    return value ? SWIPE_AREA_SWIPING_HOOK : null;
  },
  swipeDirection(value) {
    return value ? {
      [_DrawerSwipeAreaDataAttributes.DrawerSwipeAreaDataAttributes.swipeDirection]: value
    } : null;
  },
  disabled(value) {
    return value ? SWIPE_AREA_DISABLED_HOOK : null;
  }
};
const oppositeSwipeDirection = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left'
};
function resolveTouchAction(direction) {
  return direction === 'left' || direction === 'right' ? 'pan-y' : 'pan-x';
}

/**
 * An invisible area that listens for swipe gestures to open the drawer.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Drawer](https://base-ui.com/react/components/drawer)
 */
const DrawerSwipeArea = exports.DrawerSwipeArea = /*#__PURE__*/React.forwardRef(function DrawerSwipeArea(componentProps, forwardedRef) {
  const {
    render,
    className,
    style,
    disabled = false,
    swipeDirection: swipeDirectionProp,
    ...elementProps
  } = componentProps;
  const {
    store
  } = (0, _DialogRootContext.useDialogRootContext)();
  const {
    swipeDirection,
    frontmostHeight
  } = (0, _DrawerRootContext.useDrawerRootContext)();
  const providerContext = (0, _DrawerProviderContext.useDrawerProviderContext)(true);
  const [swipeActive, setSwipeActive] = React.useState(false);
  const releaseDismissTimeout = (0, _useTimeout.useTimeout)();
  const swipeAreaRef = React.useRef(null);
  const swipeStartEventRef = React.useRef(null);
  const openedBySwipeRef = React.useRef(false);
  const dragDeltaRef = React.useRef({
    x: 0,
    y: 0
  });
  const closedOffsetRef = React.useRef(null);
  const appliedSwipeStylesRef = React.useRef(false);
  const popupTransitionRef = React.useRef(null);
  const swipeAreaId = (0, _useBaseUiId.useBaseUiId)(componentProps.id);
  const registerTrigger = (0, _popups.useTriggerRegistration)(swipeAreaId, store);
  const open = store.useState('open');
  const resetDragDelta = (0, _useStableCallback.useStableCallback)(() => {
    dragDeltaRef.current.x = 0;
    dragDeltaRef.current.y = 0;
  });
  const resolvedSwipeDirection = swipeDirectionProp ?? oppositeSwipeDirection[swipeDirection];
  const dismissDirection = oppositeSwipeDirection[resolvedSwipeDirection];
  const enabled = !disabled && (!open || swipeActive);
  function disableDismissForSwipe() {
    releaseDismissTimeout.clear();
    store.context.outsidePressEnabledRef.current = false;
  }
  function enableDismissAfterRelease() {
    // Safari can dispatch outside-press for the same swipe-open gesture
    // after release, so defer re-enabling dismissal to the next macrotask.
    releaseDismissTimeout.start(0, () => {
      store.context.outsidePressEnabledRef.current = true;
    });
  }
  function resolvePopupSize() {
    const popupElement = store.context.popupRef.current;
    if (!popupElement) {
      return null;
    }
    const isHorizontal = dismissDirection === 'left' || dismissDirection === 'right';
    const size = isHorizontal ? popupElement.offsetWidth : popupElement.offsetHeight;
    if (size <= 0) {
      return null;
    }
    return size;
  }
  function resolveClosedOffset() {
    const offset = resolvePopupSize();
    if (offset == null) {
      return null;
    }
    const popupElement = store.context.popupRef.current;
    if (!popupElement) {
      return offset;
    }
    const isHorizontal = dismissDirection === 'left' || dismissDirection === 'right';
    const transform = (0, _useSwipeDismiss.getElementTransform)(popupElement);
    const transformOffset = isHorizontal ? transform.x : transform.y;
    if (Number.isFinite(transformOffset) && Math.abs(transformOffset) > 0.5) {
      return Math.min(offset, Math.abs(transformOffset));
    }
    return offset;
  }
  function resolveSwipeOpenThreshold() {
    const popupSize = resolvePopupSize();
    if (popupSize == null) {
      return FALLBACK_SWIPE_OPEN_THRESHOLD;
    }
    return popupSize * DEFAULT_SWIPE_OPEN_RATIO;
  }
  function applySwipeMovement() {
    if (!swipeActive) {
      return;
    }
    const popupElement = store.context.popupRef.current;
    if (!popupElement) {
      return;
    }
    if (!store.select('open') || !store.select('mounted')) {
      return;
    }
    if (closedOffsetRef.current == null) {
      closedOffsetRef.current = resolveClosedOffset();
    }
    const closedOffset = closedOffsetRef.current;
    if (!closedOffset || !Number.isFinite(closedOffset) || closedOffset <= 0) {
      return;
    }
    const {
      x,
      y
    } = dragDeltaRef.current;
    const displacement = (0, _useSwipeDismiss.getDisplacement)(resolvedSwipeDirection, x, y);
    const clampedDisplacement = Math.max(0, displacement);
    const dampedDisplacement = clampedDisplacement > closedOffset ? closedOffset + Math.sqrt(clampedDisplacement - closedOffset) : clampedDisplacement;
    const remaining = closedOffset - dampedDisplacement;
    const directionSign = dismissDirection === 'left' || dismissDirection === 'up' ? -1 : 1;
    const movement = remaining * directionSign;
    const isHorizontal = dismissDirection === 'left' || dismissDirection === 'right';
    const movementX = isHorizontal ? movement : 0;
    const movementY = isHorizontal ? 0 : movement;
    const openProgress = Math.max(0, Math.min(1, clampedDisplacement / closedOffset));
    const backdropProgress = Math.max(0, Math.min(1, 1 - openProgress));
    popupElement.style.setProperty(_DrawerPopupCssVars.DrawerPopupCssVars.swipeMovementX, `${movementX}px`);
    popupElement.style.setProperty(_DrawerPopupCssVars.DrawerPopupCssVars.swipeMovementY, `${movementY}px`);
    popupElement.setAttribute(_DrawerPopupDataAttributes.DrawerPopupDataAttributes.swiping, '');
    if (popupTransitionRef.current === null) {
      popupTransitionRef.current = popupElement.style.transition;
    }
    popupElement.style.transition = 'none';
    const backdropElement = store.context.backdropRef.current;
    if (backdropElement) {
      backdropElement.setAttribute(_DrawerPopupDataAttributes.DrawerPopupDataAttributes.swiping, '');
      backdropElement.style.setProperty(_DrawerBackdropCssVars.DrawerBackdropCssVars.swipeProgress, `${backdropProgress}`);
      if (openProgress > 0 && frontmostHeight > 0) {
        backdropElement.style.setProperty(_DrawerPopupCssVars.DrawerPopupCssVars.height, `${frontmostHeight}px`);
      } else {
        backdropElement.style.removeProperty(_DrawerPopupCssVars.DrawerPopupCssVars.height);
      }
    }
    providerContext?.visualStateStore.set({
      swipeProgress: openProgress,
      frontmostHeight: openProgress > 0 ? frontmostHeight : 0
    });
    appliedSwipeStylesRef.current = true;
  }
  const clearSwipeStyles = (0, _useStableCallback.useStableCallback)(() => {
    const popupElement = store.context.popupRef.current;
    if (popupElement && appliedSwipeStylesRef.current) {
      popupElement.style.removeProperty(_DrawerPopupCssVars.DrawerPopupCssVars.swipeMovementX);
      popupElement.style.removeProperty(_DrawerPopupCssVars.DrawerPopupCssVars.swipeMovementY);
      popupElement.removeAttribute(_DrawerPopupDataAttributes.DrawerPopupDataAttributes.swiping);
    }
    if (popupElement && popupTransitionRef.current !== null) {
      popupElement.style.transition = popupTransitionRef.current;
      popupTransitionRef.current = null;
    }
    const backdropElement = store.context.backdropRef.current;
    if (backdropElement) {
      backdropElement.removeAttribute(_DrawerPopupDataAttributes.DrawerPopupDataAttributes.swiping);
      backdropElement.style.setProperty(_DrawerBackdropCssVars.DrawerBackdropCssVars.swipeProgress, '0');
      backdropElement.style.removeProperty(_DrawerPopupCssVars.DrawerPopupCssVars.height);
    }
    providerContext?.visualStateStore.set({
      swipeProgress: 0,
      frontmostHeight: 0
    });
    appliedSwipeStylesRef.current = false;
  });
  function openDrawer(event) {
    if (store.select('open')) {
      return;
    }
    openedBySwipeRef.current = true;
    store.setOpen(true, (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.swipe, event, swipeAreaRef.current ?? undefined));
  }
  function closeDrawer(event) {
    if (!store.select('open')) {
      return;
    }
    store.setOpen(false, (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.swipe, event, swipeAreaRef.current ?? undefined));
  }
  function resetSwipeInteractionState() {
    swipeStartEventRef.current = null;
    openedBySwipeRef.current = false;
    closedOffsetRef.current = null;
    setSwipeActive(false);
  }
  function finishSwipeInteraction() {
    resetSwipeInteractionState();
    enableDismissAfterRelease();
    resetDragDelta();
    clearSwipeStyles();
  }
  const swipe = (0, _useSwipeDismiss.useSwipeDismiss)({
    enabled,
    directions: [resolvedSwipeDirection],
    elementRef: swipeAreaRef,
    trackDrag: false,
    movementCssVars: {
      x: _DrawerPopupCssVars.DrawerPopupCssVars.swipeMovementX,
      y: _DrawerPopupCssVars.DrawerPopupCssVars.swipeMovementY
    },
    onSwipeStart(event) {
      disableDismissForSwipe();
      swipeStartEventRef.current = event;
      openedBySwipeRef.current = false;
      setSwipeActive(true);
      resetDragDelta();
    },
    onProgress(_progress, details) {
      if (!details) {
        return;
      }
      if (!swipeStartEventRef.current) {
        return;
      }
      dragDeltaRef.current.x = details.deltaX;
      dragDeltaRef.current.y = details.deltaY;
      if (details.direction !== resolvedSwipeDirection) {
        return;
      }
      const displacement = (0, _useSwipeDismiss.getDisplacement)(resolvedSwipeDirection, details.deltaX, details.deltaY);
      if (displacement < MIN_SWIPE_START_DISTANCE && !openedBySwipeRef.current) {
        return;
      }
      if (!openedBySwipeRef.current) {
        openDrawer(swipeStartEventRef.current);
      }
      applySwipeMovement();
    },
    onRelease({
      event,
      direction,
      deltaX,
      deltaY,
      releaseVelocityX,
      releaseVelocityY
    }) {
      const displacement = (0, _useSwipeDismiss.getDisplacement)(resolvedSwipeDirection, deltaX, deltaY);
      const releaseVelocity = (0, _useSwipeDismiss.getDisplacement)(resolvedSwipeDirection, releaseVelocityX, releaseVelocityY);
      const threshold = resolveSwipeOpenThreshold();
      const hasEnoughDistance = threshold != null && displacement >= threshold;
      const hasEnoughVelocity = releaseVelocity >= VELOCITY_THRESHOLD;
      const shouldOpen = threshold != null && direction === resolvedSwipeDirection && (hasEnoughDistance || hasEnoughVelocity) && !disabled;
      if (shouldOpen) {
        if (!store.select('open')) {
          openDrawer(event);
        }
      } else if (openedBySwipeRef.current) {
        closeDrawer(event);
      }
      finishSwipeInteraction();
      return false;
    },
    onCancel: finishSwipeInteraction
  });
  const swipePointerProps = swipe.getPointerProps();
  const swipeTouchProps = swipe.getTouchProps();
  const resetSwipe = swipe.reset;
  React.useEffect(() => {
    if (!enabled) {
      resetSwipe();
      resetDragDelta();
      clearSwipeStyles();
      resetSwipeInteractionState();
    }
  }, [clearSwipeStyles, enabled, resetDragDelta, resetSwipe]);
  React.useEffect(() => {
    return () => {
      store.context.outsidePressEnabledRef.current = true;
    };
  }, [store]);
  const state = {
    open,
    swiping: swipe.swiping,
    swipeDirection: resolvedSwipeDirection,
    disabled
  };
  return (0, _useRenderElement.useRenderElement)('div', componentProps, {
    state,
    ref: [forwardedRef, swipeAreaRef, registerTrigger],
    stateAttributesMapping,
    props: [{
      role: 'presentation',
      'aria-hidden': true,
      style: {
        pointerEvents: !enabled ? 'none' : undefined,
        touchAction: resolveTouchAction(resolvedSwipeDirection)
      },
      onPointerDown(event) {
        if (event.pointerType === 'touch') {
          return;
        }
        swipePointerProps.onPointerDown?.(event);

        // Prevent native text selection/drag gestures from competing with swipe-open dragging.
        if (event.cancelable) {
          event.preventDefault();
        }
      },
      onPointerMove(event) {
        if (event.pointerType === 'touch') {
          return;
        }
        swipePointerProps.onPointerMove?.(event);
      },
      onPointerUp(event) {
        if (event.pointerType === 'touch') {
          return;
        }
        swipePointerProps.onPointerUp?.(event);
      },
      onPointerCancel(event) {
        if (event.pointerType === 'touch') {
          return;
        }
        swipePointerProps.onPointerCancel?.(event);
      }
    }, swipeTouchProps, swipeAreaId ? {
      id: swipeAreaId
    } : undefined, elementProps]
  });
});
if (process.env.NODE_ENV !== "production") DrawerSwipeArea.displayName = "DrawerSwipeArea";