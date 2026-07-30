import * as React from 'react';
export interface DrawerProviderContext {
  setDrawerOpen: (drawerId: string, open: boolean) => void;
  removeDrawer: (drawerId: string) => void;
  active: boolean;
  visualStateStore: DrawerVisualStateStore;
}
export declare const DrawerProviderContext: React.Context<DrawerProviderContext | undefined>;
export interface DrawerVisualState {
  swipeProgress: number;
  frontmostHeight: number;
}
export interface DrawerVisualStateStore {
  getSnapshot: () => DrawerVisualState;
  subscribe: (listener: () => void) => () => void;
  set: (state: Partial<DrawerVisualState>) => void;
}
export declare function useDrawerProviderContext(optional?: false): DrawerProviderContext;
export declare function useDrawerProviderContext(optional: true): DrawerProviderContext | undefined;