"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
var _interopRequireDefault = require("@babel/runtime/helpers/interopRequireDefault").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.TooltipTrigger = void 0;
var _formatErrorMessage2 = _interopRequireDefault(require("@base-ui/utils/formatErrorMessage"));
var React = _interopRequireWildcard(require("react"));
var _dom = require("@floating-ui/utils/dom");
var _fastHooks = require("@base-ui/utils/fastHooks");
var _useTimeout = require("@base-ui/utils/useTimeout");
var _useValueAsRef = require("@base-ui/utils/useValueAsRef");
var _TooltipRootContext = require("../root/TooltipRootContext");
var _popupStateMapping = require("../../utils/popupStateMapping");
var _useRenderElement = require("../../internals/useRenderElement");
var _popups = require("../../utils/popups");
var _useBaseUiId = require("../../internals/useBaseUiId");
var _TooltipProviderContext = require("../provider/TooltipProviderContext");
var _floatingUiReact = require("../../floating-ui-react");
var _element = require("../../floating-ui-react/utils/element");
var _event = require("../../floating-ui-react/utils/event");
var _createBaseUIEventDetails = require("../../internals/createBaseUIEventDetails");
var _reasons = require("../../internals/reasons");
var _TooltipTriggerDataAttributes = require("./TooltipTriggerDataAttributes");
var _useHoverInteractionSharedState = require("../../floating-ui-react/hooks/useHoverInteractionSharedState");
var _constants = require("../utils/constants");
const TOOLTIP_TRIGGER_IDENTIFIER = 'data-base-ui-tooltip-trigger';
function getTargetElement(event) {
  if ('composedPath' in event) {
    const path = event.composedPath();
    for (let i = 0; i < path.length; i += 1) {
      const element = path[i];
      if ((0, _dom.isElement)(element)) {
        return element;
      }
    }
  }
  const target = event.target;
  if ((0, _dom.isElement)(target)) {
    return target;
  }
  return null;
}
function closestEnabledTooltipTrigger(element) {
  let current = element;
  while (current) {
    if (current.hasAttribute(TOOLTIP_TRIGGER_IDENTIFIER)) {
      return current;
    }
    const parentElement = current.parentElement;
    if (parentElement) {
      current = parentElement;
      continue;
    }
    const root = current.getRootNode();
    current = 'host' in root && (0, _dom.isElement)(root.host) ? root.host : null;
  }
  return null;
}

/**
 * An element to attach the tooltip to.
 * Renders a `<button>` element.
 *
 * Documentation: [Base UI Tooltip](https://base-ui.com/react/components/tooltip)
 */
const TooltipTrigger = exports.TooltipTrigger = (0, _fastHooks.fastComponentRef)(function TooltipTrigger(componentProps, forwardedRef) {
  const {
    render,
    className,
    style,
    handle,
    payload,
    disabled: disabledProp,
    delay,
    closeOnClick = true,
    closeDelay,
    id: idProp,
    ...elementProps
  } = componentProps;
  const rootContext = (0, _TooltipRootContext.useTooltipRootContext)(true);
  const store = handle?.store ?? rootContext;
  if (!store) {
    throw new Error(process.env.NODE_ENV !== "production" ? 'Base UI: <Tooltip.Trigger> must be either used within a <Tooltip.Root> component or provided with a handle.' : (0, _formatErrorMessage2.default)(82));
  }
  const thisTriggerId = (0, _useBaseUiId.useBaseUiId)(idProp);
  const isTriggerActive = store.useState('isTriggerActive', thisTriggerId);
  const isOpenedByThisTrigger = store.useState('isOpenedByTrigger', thisTriggerId);
  const floatingRootContext = store.useState('floatingRootContext');
  const triggerElementRef = React.useRef(null);
  const delayWithDefault = delay ?? _constants.OPEN_DELAY;
  const closeDelayWithDefault = closeDelay ?? 0;
  const {
    registerTrigger,
    isMountedByThisTrigger
  } = (0, _popups.useTriggerDataForwarding)(thisTriggerId, triggerElementRef, store, {
    payload,
    closeOnClick,
    closeDelay: closeDelayWithDefault
  });
  const providerContext = (0, _TooltipProviderContext.useTooltipProviderContext)();
  const {
    delayRef,
    isInstantPhase,
    hasProvider
  } = (0, _floatingUiReact.useDelayGroup)(floatingRootContext, {
    open: isOpenedByThisTrigger
  });
  const hoverInteraction = (0, _useHoverInteractionSharedState.useHoverInteractionSharedState)(floatingRootContext);
  store.useSyncedValue('isInstantPhase', isInstantPhase);
  const rootDisabled = store.useState('disabled');
  const disabled = disabledProp ?? rootDisabled;
  const disabledRef = (0, _useValueAsRef.useValueAsRef)(disabled);
  const trackCursorAxis = store.useState('trackCursorAxis');
  const disableHoverablePopup = store.useState('disableHoverablePopup');
  const isNestedTriggerHoveredRef = React.useRef(false);
  const nestedTriggerOpenTimeout = (0, _useTimeout.useTimeout)();
  // Local copy so it can be cleared on mouseLeave without resetting the hover hook's own pointerType.
  const pointerTypeRef = React.useRef(undefined);
  function getOpenDelay() {
    const providerDelay = providerContext?.delay;
    const groupOpenValue = typeof delayRef.current === 'object' ? delayRef.current.open : undefined;
    let computedOpenDelay = delayWithDefault;
    if (hasProvider) {
      if (groupOpenValue !== 0) {
        computedOpenDelay = delay ?? providerDelay ?? delayWithDefault;
      } else {
        computedOpenDelay = 0;
      }
    }
    return computedOpenDelay;
  }
  function isEnabledNestedTriggerTarget(target) {
    const triggerEl = triggerElementRef.current;
    if (!triggerEl || !target) {
      return false;
    }
    const nearestTrigger = closestEnabledTooltipTrigger(target);
    return nearestTrigger !== null && nearestTrigger !== triggerEl && (0, _element.contains)(triggerEl, nearestTrigger);
  }
  function detectNestedTriggerHover(target) {
    const nestedTriggerHovered = isEnabledNestedTriggerTarget(target);
    isNestedTriggerHoveredRef.current = nestedTriggerHovered;
    if (nestedTriggerHovered) {
      hoverInteraction.openChangeTimeout.clear();
      hoverInteraction.restTimeout.clear();
      hoverInteraction.restTimeoutPending = false;
      nestedTriggerOpenTimeout.clear();
    }
    return nestedTriggerHovered;
  }
  const hoverProps = (0, _floatingUiReact.useHoverReferenceInteraction)(floatingRootContext, {
    enabled: !disabled,
    mouseOnly: true,
    move: false,
    handleClose: !disableHoverablePopup && trackCursorAxis !== 'both' ? (0, _floatingUiReact.safePolygon)() : null,
    restMs: getOpenDelay,
    delay() {
      const closeValue = typeof delayRef.current === 'object' ? delayRef.current.close : undefined;
      let computedCloseDelay = closeDelayWithDefault;
      if (closeDelay == null && hasProvider) {
        computedCloseDelay = closeValue;
      }
      return {
        close: computedCloseDelay
      };
    },
    triggerElementRef,
    isActiveTrigger: isTriggerActive,
    isClosing: () => store.select('transitionStatus') === 'ending',
    shouldOpen() {
      return !isNestedTriggerHoveredRef.current;
    }
  });
  const focusProps = (0, _floatingUiReact.useFocus)(floatingRootContext, {
    enabled: !disabled
  }).reference;
  const handleNestedTriggerHover = event => {
    const wasNestedTriggerHovered = isNestedTriggerHoveredRef.current;
    const target = getTargetElement(event);
    const nestedTriggerHovered = detectNestedTriggerHover(target);
    const triggerEl = triggerElementRef.current;
    const targetInsideTrigger = triggerEl && target && (0, _element.contains)(triggerEl, target);

    // Only close hover-opened parents. Focus/click-like opens remain owned by
    // their original interaction and should not be clobbered by nested hover.
    if (nestedTriggerHovered && store.select('open') && store.select('lastOpenChangeReason') === _reasons.REASONS.triggerHover) {
      store.setOpen(false, (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.triggerHover, event));
      return;
    }
    if (wasNestedTriggerHovered && !nestedTriggerHovered && targetInsideTrigger && !disabledRef.current && !store.select('open') && triggerEl &&
    // Match the hover hook's non-strict mouse fallback for mouse-only event sequences.
    (0, _event.isMouseLikePointerType)(pointerTypeRef.current)) {
      const open = () => {
        if (!isNestedTriggerHoveredRef.current && !disabledRef.current && !store.select('open')) {
          store.setOpen(true, (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.triggerHover, event, triggerEl));
        }
      };
      const openDelay = getOpenDelay();

      // With `move: false`, the hover hook only listens to mouseenter/mouseleave
      // on the parent trigger. Leaving a nested child for the parent area fires
      // no event the hook can react to, so reopen locally.
      if (openDelay === 0) {
        nestedTriggerOpenTimeout.clear();
        open();
      } else {
        nestedTriggerOpenTimeout.start(openDelay, open);
      }
    }
  };
  const rootTriggerProps = store.useState('triggerProps', isMountedByThisTrigger);
  const shouldApplyRootTriggerProps = isMountedByThisTrigger || trackCursorAxis !== 'none';
  const state = {
    open: isOpenedByThisTrigger
  };
  const element = (0, _useRenderElement.useRenderElement)('button', componentProps, {
    state,
    ref: [forwardedRef, registerTrigger, triggerElementRef],
    props: [hoverProps, focusProps, shouldApplyRootTriggerProps ? rootTriggerProps : undefined, {
      onMouseOver(event) {
        handleNestedTriggerHover(event.nativeEvent);
      },
      onFocus(event) {
        if (isEnabledNestedTriggerTarget(getTargetElement(event.nativeEvent))) {
          event.preventBaseUIHandler();
        }
      },
      onMouseLeave() {
        isNestedTriggerHoveredRef.current = false;
        nestedTriggerOpenTimeout.clear();
        pointerTypeRef.current = undefined;
      },
      onPointerEnter(event) {
        pointerTypeRef.current = event.pointerType;
      },
      onPointerDown(event) {
        pointerTypeRef.current = event.pointerType;
        store.set('closeOnClick', closeOnClick);
        if (closeOnClick && !store.select('open')) {
          store.cancelPendingOpen(event.nativeEvent);
        }
      },
      onClick(event) {
        if (closeOnClick && !store.select('open')) {
          store.cancelPendingOpen(event.nativeEvent);
        }
      },
      id: thisTriggerId,
      [_TooltipTriggerDataAttributes.TooltipTriggerDataAttributes.triggerDisabled]: disabled ? '' : undefined,
      [TOOLTIP_TRIGGER_IDENTIFIER]: disabled ? undefined : ''
    }, elementProps],
    stateAttributesMapping: _popupStateMapping.triggerOpenStateMapping
  });
  return element;
});
if (process.env.NODE_ENV !== "production") TooltipTrigger.displayName = "TooltipTrigger";