"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.TabsPanel = void 0;
var React = _interopRequireWildcard(require("react"));
var _inertValue = require("@base-ui/utils/inertValue");
var _useIsoLayoutEffect = require("@base-ui/utils/useIsoLayoutEffect");
var _useBaseUiId = require("../../internals/useBaseUiId");
var _stateAttributesMapping = require("../../internals/stateAttributesMapping");
var _useOpenChangeComplete = require("../../internals/useOpenChangeComplete");
var _useTransitionStatus = require("../../internals/useTransitionStatus");
var _useRenderElement = require("../../internals/useRenderElement");
var _useCompositeListItem = require("../../internals/composite/list/useCompositeListItem");
var _stateAttributesMapping2 = require("../root/stateAttributesMapping");
var _TabsRootContext = require("../root/TabsRootContext");
var _TabsPanelDataAttributes = require("./TabsPanelDataAttributes");
const stateAttributesMapping = {
  ..._stateAttributesMapping2.tabsStateAttributesMapping,
  ..._stateAttributesMapping.transitionStatusMapping
};

/**
 * A panel displayed when the corresponding tab is active.
 * Renders a `<div>` element.
 *
 * Documentation: [Base UI Tabs](https://base-ui.com/react/components/tabs)
 */
const TabsPanel = exports.TabsPanel = /*#__PURE__*/React.forwardRef(function TabsPanel(componentProps, forwardedRef) {
  const {
    className,
    value,
    render,
    keepMounted = false,
    style,
    ...elementProps
  } = componentProps;
  const {
    value: selectedValue,
    getTabIdByPanelValue,
    orientation,
    tabActivationDirection,
    registerMountedTabPanel,
    unregisterMountedTabPanel
  } = (0, _TabsRootContext.useTabsRootContext)();
  const id = (0, _useBaseUiId.useBaseUiId)();
  const metadata = React.useMemo(() => ({
    id,
    value
  }), [id, value]);
  const {
    ref: listItemRef,
    index
  } = (0, _useCompositeListItem.useCompositeListItem)({
    metadata
  });
  const open = value === selectedValue;
  const {
    mounted,
    transitionStatus,
    setMounted
  } = (0, _useTransitionStatus.useTransitionStatus)(open);
  const hidden = !mounted;
  const correspondingTabId = getTabIdByPanelValue(value);
  const state = {
    hidden,
    orientation,
    tabActivationDirection,
    transitionStatus
  };
  const panelRef = React.useRef(null);
  const element = (0, _useRenderElement.useRenderElement)('div', componentProps, {
    state,
    ref: [forwardedRef, listItemRef, panelRef],
    props: [{
      'aria-labelledby': correspondingTabId,
      hidden,
      id,
      role: 'tabpanel',
      tabIndex: open ? 0 : -1,
      inert: (0, _inertValue.inertValue)(!open),
      [_TabsPanelDataAttributes.TabsPanelDataAttributes.index]: index
    }, elementProps],
    stateAttributesMapping
  });
  (0, _useOpenChangeComplete.useOpenChangeComplete)({
    open,
    ref: panelRef,
    onComplete() {
      if (!open) {
        setMounted(false);
      }
    }
  });
  (0, _useIsoLayoutEffect.useIsoLayoutEffect)(() => {
    if (hidden && !keepMounted) {
      return undefined;
    }
    if (id == null) {
      return undefined;
    }
    registerMountedTabPanel(value, id);
    return () => {
      unregisterMountedTabPanel(value, id);
    };
  }, [hidden, keepMounted, value, id, registerMountedTabPanel, unregisterMountedTabPanel]);
  const shouldRender = keepMounted || mounted;
  if (!shouldRender) {
    return null;
  }
  return element;
});
if (process.env.NODE_ENV !== "production") TabsPanel.displayName = "TabsPanel";