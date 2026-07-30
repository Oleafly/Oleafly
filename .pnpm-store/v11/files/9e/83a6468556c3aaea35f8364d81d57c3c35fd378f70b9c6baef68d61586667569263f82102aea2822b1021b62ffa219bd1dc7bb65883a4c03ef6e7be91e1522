import * as React from 'react';
import type { TabsRoot } from "../root/TabsRoot.js";
import type { TabsTab } from "../tab/TabsTab.js";
export interface TabsListContext {
  activateOnFocus: boolean;
  highlightedTabIndex: number;
  registerIndicatorUpdateListener: (listener: () => void) => () => void;
  registerTabResizeObserverElement: (element: HTMLElement) => () => void;
  onTabActivation: (newValue: TabsTab.Value, eventDetails: TabsRoot.ChangeEventDetails) => void;
  setHighlightedTabIndex: (index: number) => void;
  tabsListElement: HTMLElement | null;
}
export declare const TabsListContext: React.Context<TabsListContext | undefined>;
export declare function useTabsListContext(): TabsListContext;