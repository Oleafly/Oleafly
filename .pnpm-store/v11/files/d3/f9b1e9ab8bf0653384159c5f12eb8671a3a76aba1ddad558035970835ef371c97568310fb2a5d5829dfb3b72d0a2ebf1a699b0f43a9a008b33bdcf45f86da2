'use client';

import * as React from 'react';
import { ownerDocument } from '@base-ui/utils/owner';
import { useIsoLayoutEffect } from '@base-ui/utils/useIsoLayoutEffect';
import { useBaseUiId } from "../../internals/useBaseUiId.mjs";
import { useRenderElement } from "../../internals/useRenderElement.mjs";
import { useButton } from "../../internals/use-button/index.mjs";
import { ACTIVE_COMPOSITE_ITEM } from "../../internals/composite/constants.mjs";
import { useCompositeItem } from "../../internals/composite/item/useCompositeItem.mjs";
import { useTabsRootContext } from "../root/TabsRootContext.mjs";
import { tabsStateAttributesMapping } from "../root/stateAttributesMapping.mjs";
import { useTabsListContext } from "../list/TabsListContext.mjs";
import { createChangeEventDetails } from "../../internals/createBaseUIEventDetails.mjs";
import { REASONS } from "../../internals/reasons.mjs";
import { activeElement, contains } from "../../floating-ui-react/utils.mjs";

/**
 * An individual interactive tab button that toggles the corresponding panel.
 * Renders a `<button>` element.
 *
 * Documentation: [Base UI Tabs](https://base-ui.com/react/components/tabs)
 */
export const TabsTab = /*#__PURE__*/React.forwardRef(function TabsTab(componentProps, forwardedRef) {
  const {
    className,
    disabled = false,
    render,
    value,
    id: idProp,
    nativeButton = true,
    style,
    ...elementProps
  } = componentProps;
  const {
    value: activeTabValue,
    getTabPanelIdByValue,
    orientation,
    tabActivationDirection
  } = useTabsRootContext();
  const {
    activateOnFocus,
    highlightedTabIndex,
    onTabActivation,
    registerTabResizeObserverElement,
    setHighlightedTabIndex,
    tabsListElement
  } = useTabsListContext();
  const id = useBaseUiId(idProp);
  const tabMetadata = React.useMemo(() => ({
    disabled,
    id,
    value
  }), [disabled, id, value]);
  const {
    compositeProps,
    compositeRef,
    index
    // hook is used instead of the CompositeItem component
    // because the index is needed for Tab internals
  } = useCompositeItem({
    metadata: tabMetadata
  });
  const active = value === activeTabValue;
  const isNavigatingRef = React.useRef(false);
  const tabElementRef = React.useRef(null);
  useIsoLayoutEffect(() => {
    const tabElement = tabElementRef.current;
    if (!tabElement) {
      return undefined;
    }
    return registerTabResizeObserverElement(tabElement);
  }, [registerTabResizeObserverElement]);

  // Keep the highlighted item in sync with the currently active tab
  // when the value prop changes externally (controlled mode)
  useIsoLayoutEffect(() => {
    if (isNavigatingRef.current) {
      isNavigatingRef.current = false;
      return;
    }
    if (!(active && index > -1 && highlightedTabIndex !== index)) {
      return;
    }

    // If focus is currently within the tabs list, don't override the roving
    // focus highlight. This keeps keyboard navigation relative to the focused
    // item after an external/asynchronous selection change.
    const listElement = tabsListElement;
    if (listElement != null) {
      const activeEl = activeElement(ownerDocument(listElement));
      if (activeEl && contains(listElement, activeEl)) {
        return;
      }
    }

    // Don't highlight disabled tabs to prevent them from interfering with keyboard navigation.
    // Keyboard focus (tabIndex) should remain on an enabled tab even when a disabled tab is selected.
    if (!disabled) {
      setHighlightedTabIndex(index);
    }
  }, [active, index, highlightedTabIndex, setHighlightedTabIndex, disabled, tabsListElement]);
  const {
    getButtonProps,
    buttonRef
  } = useButton({
    disabled,
    native: nativeButton,
    focusableWhenDisabled: true
  });
  const tabPanelId = getTabPanelIdByValue(value);
  const isPressingRef = React.useRef(false);
  const isMainButtonRef = React.useRef(false);
  function onClick(event) {
    if (active || disabled) {
      return;
    }
    onTabActivation(value, createChangeEventDetails(REASONS.none, event.nativeEvent, undefined, {
      activationDirection: 'none'
    }));
  }
  function onFocus(event) {
    if (active) {
      return;
    }

    // Only highlight enabled tabs when focused (disabled tabs remain focusable via focusableWhenDisabled).
    if (index > -1 && !disabled) {
      setHighlightedTabIndex(index);
    }
    if (disabled) {
      return;
    }
    if (activateOnFocus && (!isPressingRef.current ||
    // keyboard or touch focus
    isPressingRef.current && isMainButtonRef.current) // mouse focus
    ) {
      onTabActivation(value, createChangeEventDetails(REASONS.none, event.nativeEvent, undefined, {
        activationDirection: 'none'
      }));
    }
  }
  function onPointerDown(event) {
    if (active || disabled) {
      return;
    }
    isPressingRef.current = true;
    function handlePointerUp() {
      isPressingRef.current = false;
      isMainButtonRef.current = false;
    }
    if (!event.button || event.button === 0) {
      isMainButtonRef.current = true;
      const doc = ownerDocument(event.currentTarget);
      doc.addEventListener('pointerup', handlePointerUp, {
        once: true
      });
    }
  }
  const state = {
    disabled,
    active,
    orientation,
    tabActivationDirection
  };
  const element = useRenderElement('button', componentProps, {
    state,
    ref: [forwardedRef, buttonRef, compositeRef, tabElementRef],
    props: [compositeProps, {
      role: 'tab',
      'aria-controls': tabPanelId,
      'aria-selected': active,
      id,
      onClick,
      onFocus,
      onPointerDown,
      [ACTIVE_COMPOSITE_ITEM]: active ? '' : undefined,
      onKeyDownCapture() {
        isNavigatingRef.current = true;
      }
    }, elementProps, getButtonProps],
    stateAttributesMapping: tabsStateAttributesMapping
  });
  return element;
});
if (process.env.NODE_ENV !== "production") TabsTab.displayName = "TabsTab";