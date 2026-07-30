"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.TabsTab = void 0;
var React = _interopRequireWildcard(require("react"));
var _owner = require("@base-ui/utils/owner");
var _useIsoLayoutEffect = require("@base-ui/utils/useIsoLayoutEffect");
var _useBaseUiId = require("../../internals/useBaseUiId");
var _useRenderElement = require("../../internals/useRenderElement");
var _useButton = require("../../internals/use-button");
var _constants = require("../../internals/composite/constants");
var _useCompositeItem = require("../../internals/composite/item/useCompositeItem");
var _TabsRootContext = require("../root/TabsRootContext");
var _stateAttributesMapping = require("../root/stateAttributesMapping");
var _TabsListContext = require("../list/TabsListContext");
var _createBaseUIEventDetails = require("../../internals/createBaseUIEventDetails");
var _reasons = require("../../internals/reasons");
var _utils = require("../../floating-ui-react/utils");
/**
 * An individual interactive tab button that toggles the corresponding panel.
 * Renders a `<button>` element.
 *
 * Documentation: [Base UI Tabs](https://base-ui.com/react/components/tabs)
 */
const TabsTab = exports.TabsTab = /*#__PURE__*/React.forwardRef(function TabsTab(componentProps, forwardedRef) {
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
  } = (0, _TabsRootContext.useTabsRootContext)();
  const {
    activateOnFocus,
    highlightedTabIndex,
    onTabActivation,
    registerTabResizeObserverElement,
    setHighlightedTabIndex,
    tabsListElement
  } = (0, _TabsListContext.useTabsListContext)();
  const id = (0, _useBaseUiId.useBaseUiId)(idProp);
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
  } = (0, _useCompositeItem.useCompositeItem)({
    metadata: tabMetadata
  });
  const active = value === activeTabValue;
  const isNavigatingRef = React.useRef(false);
  const tabElementRef = React.useRef(null);
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    const tabElement = tabElementRef.current;
    if (!tabElement) {
      return undefined;
    }
    return registerTabResizeObserverElement(tabElement);
  }, [registerTabResizeObserverElement]);

  // Keep the highlighted item in sync with the currently active tab
  // when the value prop changes externally (controlled mode)
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
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
      const activeEl = (0, _utils.activeElement)((0, _owner.ownerDocument)(listElement));
      if (activeEl && (0, _utils.contains)(listElement, activeEl)) {
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
  } = (0, _useButton.useButton)({
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
    onTabActivation(value, (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.none, event.nativeEvent, undefined, {
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
      onTabActivation(value, (0, _createBaseUIEventDetails.createChangeEventDetails)(_reasons.REASONS.none, event.nativeEvent, undefined, {
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
      const doc = (0, _owner.ownerDocument)(event.currentTarget);
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
  const element = (0, _useRenderElement.useRenderElement)('button', componentProps, {
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
      [_constants.ACTIVE_COMPOSITE_ITEM]: active ? '' : undefined,
      onKeyDownCapture() {
        isNavigatingRef.current = true;
      }
    }, elementProps, getButtonProps],
    stateAttributesMapping: _stateAttributesMapping.tabsStateAttributesMapping
  });
  return element;
});
if (process.env.NODE_ENV !== "production") TabsTab.displayName = "TabsTab";