'use client';

import _formatErrorMessage from "@base-ui/utils/formatErrorMessage";
import * as React from 'react';
import { isElementDisabled } from '@base-ui/utils/isElementDisabled';
import { useIsoLayoutEffect } from '@base-ui/utils/useIsoLayoutEffect';
import { warn } from '@base-ui/utils/warn';
import { SafeReact } from '@base-ui/utils/safeReact';
import { EMPTY_OBJECT } from '@base-ui/utils/empty';
import { safePolygon, useClick, useHoverReferenceInteraction } from "../../floating-ui-react/index.mjs";
import { useMenuRootContext } from "../root/MenuRootContext.mjs";
import { useBaseUiId } from "../../internals/useBaseUiId.mjs";
import { triggerOpenStateMapping } from "../../utils/popupStateMapping.mjs";
import { useCompositeListItem } from "../../internals/composite/list/useCompositeListItem.mjs";
import { useMenuItem } from "../item/useMenuItem.mjs";
import { useRenderElement } from "../../internals/useRenderElement.mjs";
import { useMenuPositionerContext } from "../positioner/MenuPositionerContext.mjs";
import { useTriggerRegistration } from "../../utils/popups/index.mjs";
import { useMenuSubmenuRootContext } from "../submenu-root/MenuSubmenuRootContext.mjs";

/**
 * A menu item that opens a submenu.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Menu](https://base-ui.com/react/components/menu)
 */
export const MenuSubmenuTrigger = /*#__PURE__*/React.forwardRef(function MenuSubmenuTrigger(componentProps, forwardedRef) {
  const {
    render,
    className,
    style,
    label,
    id: idProp,
    nativeButton = false,
    openOnHover = true,
    delay = 100,
    closeDelay = 0,
    disabled: disabledProp = false,
    ...elementProps
  } = componentProps;
  const listItem = useCompositeListItem({
    label
  });
  const menuPositionerContext = useMenuPositionerContext();
  const {
    store
  } = useMenuRootContext();
  const thisTriggerId = useBaseUiId(idProp);
  const open = store.useState('open');
  const floatingRootContext = store.useState('floatingRootContext');
  const floatingTreeRoot = store.useState('floatingTreeRoot');
  const popupId = store.useState('triggerPopupId', thisTriggerId);
  const baseRegisterTrigger = useTriggerRegistration(thisTriggerId, store);
  const registerTrigger = React.useCallback(element => {
    const cleanup = baseRegisterTrigger(element);
    if (element !== null && store.select('open') && store.select('activeTriggerId') == null) {
      store.update({
        activeTriggerId: thisTriggerId,
        activeTriggerElement: element,
        closeDelay
      });
    }
    return cleanup;
  }, [baseRegisterTrigger, closeDelay, store, thisTriggerId]);
  const triggerElementRef = React.useRef(null);
  const handleTriggerElementRef = React.useCallback(el => {
    triggerElementRef.current = el;
    store.set('activeTriggerElement', el);
  }, [store]);
  const submenuRootContext = useMenuSubmenuRootContext();
  if (!submenuRootContext?.parentMenu) {
    throw new Error(process.env.NODE_ENV !== "production" ? 'Base UI: <Menu.SubmenuTrigger> must be placed in <Menu.SubmenuRoot>.' : _formatErrorMessage(37));
  }
  store.useSyncedValue('closeDelay', closeDelay);
  const parentMenuStore = submenuRootContext.parentMenu;
  const rootDisabled = store.useState('disabled');
  const parentDisabled = parentMenuStore.useState('disabled');
  const disabled = disabledProp || rootDisabled || parentDisabled;
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useIsoLayoutEffect(() => {
      const element = triggerElementRef.current;
      if (element && isElementDisabled(element) && !disabled) {
        const ownerStackMessage = SafeReact.captureOwnerStack?.() || '';
        warn(`A disabled element was detected on <Menu.SubmenuTrigger>. To properly disable the trigger, use the \`disabled\` prop on the component instead of setting it on the rendered element.${ownerStackMessage}`);
      }
    });
  }
  const itemProps = parentMenuStore.useState('itemProps');
  const highlighted = parentMenuStore.useState('isActive', listItem.index);
  const itemMetadata = React.useMemo(() => ({
    type: 'submenu-trigger',
    setActive() {
      if (parentMenuStore.select('highlightItemOnHover')) {
        parentMenuStore.set('activeIndex', listItem.index);
      }
    }
  }), [parentMenuStore, listItem.index]);
  const {
    getItemProps,
    itemRef
  } = useMenuItem({
    closeOnClick: false,
    disabled,
    highlighted,
    id: thisTriggerId,
    store,
    typingRef: parentMenuStore.context.typingRef,
    nativeButton,
    itemMetadata,
    nodeId: menuPositionerContext?.context.nodeId
  });
  const hoverEnabled = store.useState('hoverEnabled');
  const hoverProps = useHoverReferenceInteraction(floatingRootContext, {
    enabled: hoverEnabled && openOnHover && !disabled,
    handleClose: safePolygon({
      blockPointerEvents: true
    }),
    mouseOnly: true,
    move: true,
    restMs: delay,
    delay: {
      open: delay,
      close: closeDelay
    },
    shouldOpen: delay > 0 ? () => parentMenuStore.select('allowMouseEnter') : undefined,
    triggerElementRef,
    externalTree: floatingTreeRoot,
    isClosing: () => store.select('transitionStatus') === 'ending'
  });
  const click = useClick(floatingRootContext, {
    enabled: !disabled,
    event: 'mousedown',
    toggle: !openOnHover,
    ignoreMouse: openOnHover,
    stickIfOpen: false
  });
  const localInteractionProps = click.reference ?? EMPTY_OBJECT;
  const rootTriggerProps = store.useState('triggerProps', true);
  delete rootTriggerProps.id;
  const state = {
    disabled,
    highlighted,
    open
  };
  const element = useRenderElement('div', componentProps, {
    state,
    stateAttributesMapping: triggerOpenStateMapping,
    props: [localInteractionProps, hoverProps, rootTriggerProps, itemProps, {
      'aria-controls': popupId,
      tabIndex: open || highlighted ? 0 : -1,
      onBlur() {
        if (highlighted) {
          parentMenuStore.set('activeIndex', null);
        }
      }
    }, elementProps, getItemProps],
    ref: [forwardedRef, listItem.ref, itemRef, registerTrigger, handleTriggerElementRef]
  });
  return element;
});
if (process.env.NODE_ENV !== "production") MenuSubmenuTrigger.displayName = "MenuSubmenuTrigger";