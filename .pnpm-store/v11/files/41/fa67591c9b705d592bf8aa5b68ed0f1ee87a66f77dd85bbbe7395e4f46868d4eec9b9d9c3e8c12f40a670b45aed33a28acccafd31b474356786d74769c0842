'use client';

import * as React from 'react';
import { useForcedRerendering } from '@base-ui/utils/useForcedRerendering';
import { useRenderElement } from "../../internals/useRenderElement.mjs";
import { getCssDimensions } from "../../utils/getCssDimensions.mjs";
import { useIsHydrating } from "../../utils/useIsHydrating.mjs";
import { useTabsRootContext } from "../root/TabsRootContext.mjs";
import { tabsStateAttributesMapping } from "../root/stateAttributesMapping.mjs";
import { useTabsListContext } from "../list/TabsListContext.mjs";
import { script as prehydrationScript } from "./prehydrationScript.min.mjs";
import { TabsIndicatorCssVars } from "./TabsIndicatorCssVars.mjs";
import { useCSPContext } from "../../internals/csp-context/CSPContext.mjs";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const stateAttributesMapping = {
  ...tabsStateAttributesMapping,
  activeTabPosition: () => null,
  activeTabSize: () => null
};

/**
 * A visual indicator that can be styled to match the position of the currently active tab.
 * Renders a `<span>` element.
 *
 * Documentation: [Base UI Tabs](https://base-ui.com/react/components/tabs)
 */
export const TabsIndicator = /*#__PURE__*/React.forwardRef(function TabsIndicator(componentProps, forwardedRef) {
  const {
    className,
    render,
    renderBeforeHydration = false,
    style: styleProp,
    ...elementProps
  } = componentProps;
  const {
    nonce
  } = useCSPContext();
  const {
    getTabElementBySelectedValue,
    orientation,
    tabActivationDirection,
    value
  } = useTabsRootContext();
  const {
    tabsListElement,
    registerIndicatorUpdateListener
  } = useTabsListContext();
  const isHydrating = useIsHydrating();
  const rerender = useForcedRerendering();
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
      } = getCssDimensions(activeTab);
      const {
        width: tabListWidth,
        height: tabListHeight
      } = getCssDimensions(tabsListElement);
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
    [TabsIndicatorCssVars.activeTabLeft]: `${left}px`,
    [TabsIndicatorCssVars.activeTabRight]: `${right}px`,
    [TabsIndicatorCssVars.activeTabTop]: `${top}px`,
    [TabsIndicatorCssVars.activeTabBottom]: `${bottom}px`,
    [TabsIndicatorCssVars.activeTabWidth]: `${width}px`,
    [TabsIndicatorCssVars.activeTabHeight]: `${height}px`
  } : undefined;
  const displayIndicator = isTabSelected && width > 0 && height > 0;
  const state = {
    orientation,
    activeTabPosition,
    activeTabSize,
    tabActivationDirection
  };
  const element = useRenderElement('span', componentProps, {
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
  return /*#__PURE__*/_jsxs(React.Fragment, {
    children: [element, isHydrating && renderBeforeHydration && /*#__PURE__*/_jsx("script", {
      nonce: nonce
      // eslint-disable-next-line react/no-danger
      ,
      dangerouslySetInnerHTML: {
        __html: prehydrationScript
      },
      suppressHydrationWarning: true
    })]
  });
});
if (process.env.NODE_ENV !== "production") TabsIndicator.displayName = "TabsIndicator";