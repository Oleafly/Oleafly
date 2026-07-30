'use client';

import * as React from 'react';
import { addEventListener } from '@base-ui/utils/addEventListener';
import { ownerDocument } from '@base-ui/utils/owner';
import { useTimeout } from '@base-ui/utils/useTimeout';
import { contains, getTarget, stopEvent } from "../../floating-ui-react/utils.mjs";
import { useContextMenuRootContext } from "../root/ContextMenuRootContext.mjs";
import { useMenuRootContext } from "../../menu/root/MenuRootContext.mjs";
import { useRenderElement } from "../../internals/useRenderElement.mjs";
import { createChangeEventDetails } from "../../internals/createBaseUIEventDetails.mjs";
import { pressableTriggerOpenStateMapping } from "../../utils/popupStateMapping.mjs";
import { REASONS } from "../../internals/reasons.mjs";
import { findRootOwnerId } from "../../menu/utils/findRootOwnerId.mjs";
const LONG_PRESS_DELAY = 500;

/**
 * An area that opens the menu on right click or long press.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Context Menu](https://base-ui.com/react/components/context-menu)
 */
export const ContextMenuTrigger = /*#__PURE__*/React.forwardRef(function ContextMenuTrigger(componentProps, forwardedRef) {
  const {
    render,
    className,
    style,
    ...elementProps
  } = componentProps;
  const {
    setAnchor,
    actionsRef,
    internalBackdropRef,
    backdropRef,
    positionerRef,
    allowMouseUpTriggerRef,
    initialCursorPointRef,
    rootId
  } = useContextMenuRootContext(false);
  const {
    store
  } = useMenuRootContext(false);
  const open = store.useState('open');
  const disabled = store.useState('disabled');
  const triggerRef = React.useRef(null);
  const touchPositionRef = React.useRef(null);
  const longPressTimeout = useTimeout();
  const allowMouseUpTimeout = useTimeout();
  const allowMouseUpRef = React.useRef(false);
  function handleLongPress(x, y, event) {
    const isTouchEvent = event.type.startsWith('touch');
    initialCursorPointRef.current = {
      x,
      y
    };
    setAnchor({
      getBoundingClientRect() {
        return DOMRect.fromRect({
          width: isTouchEvent ? 10 : 0,
          height: isTouchEvent ? 10 : 0,
          x,
          y
        });
      }
    });
    allowMouseUpRef.current = false;
    actionsRef.current?.setOpen(true, createChangeEventDetails(REASONS.triggerPress, event));
    allowMouseUpTimeout.start(LONG_PRESS_DELAY, () => {
      allowMouseUpRef.current = true;
    });
  }
  function handleContextMenu(event) {
    if (disabled) {
      return;
    }
    allowMouseUpTriggerRef.current = true;
    stopEvent(event);
    handleLongPress(event.clientX, event.clientY, event.nativeEvent);
    const doc = ownerDocument(triggerRef.current);
    addEventListener(doc, 'mouseup', mouseEvent => {
      allowMouseUpTriggerRef.current = false;
      if (!allowMouseUpRef.current) {
        return;
      }
      allowMouseUpTimeout.clear();
      allowMouseUpRef.current = false;
      const mouseUpTarget = getTarget(mouseEvent);
      if (contains(positionerRef.current, mouseUpTarget)) {
        return;
      }
      if (rootId && mouseUpTarget && findRootOwnerId(mouseUpTarget) === rootId) {
        return;
      }
      actionsRef.current?.setOpen(false, createChangeEventDetails(REASONS.cancelOpen, mouseEvent));
    }, {
      once: true
    });
  }
  function handleTouchStart(event) {
    if (disabled) {
      return;
    }
    allowMouseUpTriggerRef.current = false;
    if (event.touches.length === 1) {
      event.stopPropagation();
      const touch = event.touches[0];
      touchPositionRef.current = {
        x: touch.clientX,
        y: touch.clientY
      };
      longPressTimeout.start(LONG_PRESS_DELAY, () => {
        if (touchPositionRef.current) {
          handleLongPress(touchPositionRef.current.x, touchPositionRef.current.y, event.nativeEvent);
        }
      });
    }
  }
  function handleTouchMove(event) {
    if (longPressTimeout.isStarted() && touchPositionRef.current && event.touches.length === 1) {
      const touch = event.touches[0];
      const moveThreshold = 10;
      const deltaX = Math.abs(touch.clientX - touchPositionRef.current.x);
      const deltaY = Math.abs(touch.clientY - touchPositionRef.current.y);
      if (deltaX > moveThreshold || deltaY > moveThreshold) {
        longPressTimeout.clear();
      }
    }
  }
  function handleTouchEnd() {
    longPressTimeout.clear();
    touchPositionRef.current = null;
  }
  React.useEffect(() => {
    function handleDocumentContextMenu(event) {
      if (disabled) {
        return;
      }
      const target = getTarget(event);
      const targetElement = target;
      if (contains(triggerRef.current, targetElement) || contains(internalBackdropRef.current, targetElement) || contains(backdropRef.current, targetElement)) {
        event.preventDefault();
      }
    }
    const doc = ownerDocument(triggerRef.current);
    return addEventListener(doc, 'contextmenu', handleDocumentContextMenu);
  }, [backdropRef, disabled, internalBackdropRef]);
  const state = {
    open
  };
  const element = useRenderElement('div', componentProps, {
    state,
    ref: [triggerRef, forwardedRef],
    props: [{
      onContextMenu: handleContextMenu,
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
      onTouchCancel: handleTouchEnd,
      style: {
        WebkitTouchCallout: 'none'
      }
    }, elementProps],
    stateAttributesMapping: pressableTriggerOpenStateMapping
  });
  return element;
});
if (process.env.NODE_ENV !== "production") ContextMenuTrigger.displayName = "ContextMenuTrigger";