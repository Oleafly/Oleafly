"use strict";
'use client';

var _interopRequireWildcard = require("@babel/runtime/helpers/interopRequireWildcard").default;
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.TabsIndicator = void 0;
var React = _interopRequireWildcard(require("react"));
var _useForcedRerendering = require("@base-ui/utils/useForcedRerendering");
var _useRenderElement = require("../../internals/useRenderElement");
var _getCssDimensions = require("../../utils/getCssDimensions");
var _useIsHydrating = require("../../utils/useIsHydrating");
var _TabsRootContext = require("../root/TabsRootContext");
var _stateAttributesMapping = require("../root/stateAttributesMapping");
var _TabsListContext = require("../list/TabsListContext");
var _prehydrationScript = require("./prehydrationScript.min");
var _TabsIndicatorCssVars = require("./TabsIndicatorCssVars");
var _CSPContext = require("../../internals/csp-context/CSPContext");
var _jsxRuntime = require("react/jsx-runtime");
const stateAttributesMapping = {
  ..._stateAttributesMapping.tabsStateAttributesMapping,
  activeTabPosition: () => null,
  activeTabSize: () => null
};

/**
 * A visual indicator that can be styled to match the position of the currently active tab.
 * Renders a `<span>` element.
 *
 * Documentation: [Base UI Tabs](https://base-ui.com/react/components/tabs)
 */
const TabsIndicator = exports.TabsIndicator = /*#__PURE__*/React.forwardRef(function TabsIndicator(componentProps, forwardedRef) {
  const {
    className,
    render,
    renderBeforeHydration = false,
    style: styleProp,
    ...elementProps
  } = componentProps;
  const {
    nonce
  } = (0, _CSPContext.useCSPContext)();
  const {
    getTabElementBySelectedValue,
    orientation,
    tabActivationDirection,
    value
  } = (0, _TabsRootContext.useTabsRootContext)();
  const {
    tabsListElement,
    registerIndicatorUpdateListener
  } = (0, _TabsListContext.useTabsListContext)();
  const isHydrating = (0, _useIsHydrating.useIsHydrating)();
  const rerender = (0, _useForcedRerendering.useForcedRerendering)();
  React.useEffect(() => {
    return registerIndicatorUpdateListener(rerender);
  }, [registerIndicatorUpdateListener, rerender]);
  let left = 0;
  let right = 0;
  let top = 0;
  let bottom = 0;
  let width = 0;
  let height = 0;
  let isTabSelected = false;
  if (value != null && tabsListElement != null) {
    const activeTab = getTabElementBySelectedValue(value);
    if (activeTab != null) {
      isTabSelected = true;
      const {
        width: computedWidth,
        height: computedHeight
      } = (0, _getCssDimensions.getCssDimensions)(activeTab);
      const {
        width: tabListWidth,
        height: tabListHeight
      } = (0, _getCssDimensions.getCssDimensions)(tabsListElement);
      const tabRect = activeTab.getBoundingClientRect();
      const tabsListRect = tabsListElement.getBoundingClientRect();
      const scaleX = tabListWidth > 0 ? tabsListRect.width / tabListWidth : 1;
      const scaleY = tabListHeight > 0 ? tabsListRect.height / tabListHeight : 1;
      const hasNonZeroScale = Math.abs(scaleX) > Number.EPSILON && Math.abs(scaleY) > Number.EPSILON;
      if (hasNonZeroScale) {
        const tabLeftDelta = tabRect.left - tabsListRect.left;
        const tabTopDelta = tabRect.top - tabsListRect.top;
        left = tabLeftDelta / scaleX + tabsListElement.scrollLeft - tabsListElement.clientLeft;
        top = tabTopDelta / scaleY + tabsListElement.scrollTop - tabsListElement.clientTop;
      } else {
        left = activeTab.offsetLeft;
        top = activeTab.offsetTop;
      }
      width = computedWidth;
      height = computedHeight;
      right = tabsListElement.scrollWidth - left - width;
      bottom = tabsListElement.scrollHeight - top - height;
    }
  }
  const activeTabPosition = isTabSelected ? {
    left,
    right,
    top,
    bottom
  } : null;
  const activeTabSize = isTabSelected ? {
    width,
    height
  } : null;
  const style = isTabSelected ? {
    [_TabsIndicatorCssVars.TabsIndicatorCssVars.activeTabLeft]: `${left}px`,
    [_TabsIndicatorCssVars.TabsIndicatorCssVars.activeTabRight]: `${right}px`,
    [_TabsIndicatorCssVars.TabsIndicatorCssVars.activeTabTop]: `${top}px`,
    [_TabsIndicatorCssVars.TabsIndicatorCssVars.activeTabBottom]: `${bottom}px`,
    [_TabsIndicatorCssVars.TabsIndicatorCssVars.activeTabWidth]: `${width}px`,
    [_TabsIndicatorCssVars.TabsIndicatorCssVars.activeTabHeight]: `${height}px`
  } : undefined;
  const displayIndicator = isTabSelected && width > 0 && height > 0;
  const state = {
    orientation,
    activeTabPosition,
    activeTabSize,
    tabActivationDirection
  };
  const element = (0, _useRenderElement.useRenderElement)('span', componentProps, {
    state,
    ref: forwardedRef,
    props: [{
      role: 'presentation',
      style,
      hidden: !displayIndicator // do not display the indicator before the layout is settled
    }, elementProps, {
      suppressHydrationWarning: true
    }],
    stateAttributesMapping
  });
  if (value == null) {
    return null;
  }
  return /*#__PURE__*/(0, _jsxRuntime.jsxs)(React.Fragment, {
    children: [element, isHydrating && renderBeforeHydration && /*#__PURE__*/(0, _jsxRuntime.jsx)("script", {
      nonce: nonce
      // eslint-disable-next-line react/no-danger
      ,
      dangerouslySetInnerHTML: {
        __html: _prehydrationScript.script
      },
      suppressHydrationWarning: true
    })]
  });
});
if (process.env.NODE_ENV !== "production") TabsIndicator.displayName = "TabsIndicator";