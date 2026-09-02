import { invoke } from "@tauri-apps/api/core";

export const BROWSER_EVENTS = {
  pageLoad: "browser-page-load",
  tabOpened: "browser-tab-opened",
  tabClosed: "browser-tab-closed",
  tabActivated: "browser-tab-activated",
  title: "browser-title",
  windowClosed: "browser-window-closed",
  homePage: "browser-home-page",
} as const;

export interface BrowserTabInfo {
  label: string;
  url: string;
  title: string;
  loading: boolean;
}

export interface BrowserSnapshot {
  window: string;
  tabs: BrowserTabInfo[];
  active: string | null;
}

export interface BrowserPageLoadPayload {
  label: string;
  state: "started" | "finished";
  url: string;
  active: boolean;
}

export interface BrowserTabOpenedPayload {
  label: string;
  url: string;
  active: boolean;
}

export interface BrowserTabClosedPayload {
  label: string;
  active: string | null;
}

export interface BrowserLabelPayload {
  label: string;
}

export interface BrowserTitlePayload {
  label: string;
  title: string;
}

export interface BrowserHomePagePayload {
  url: string;
}

export function browserWindowOpen(url: string): Promise<string> {
  return invoke<string>("browser_window_open", { url });
}

export function browserWindowFocus(label: string): Promise<void> {
  return invoke<void>("browser_window_focus", { label });
}

export function browserWindowClose(label: string): Promise<void> {
  return invoke<void>("browser_window_close", { label });
}

export function browserState(): Promise<BrowserSnapshot> {
  return invoke<BrowserSnapshot>("browser_state");
}

export function browserTabOpen(url: string): Promise<string> {
  return invoke<string>("browser_tab_open", { url });
}

export function browserTabActivate(tab: string): Promise<void> {
  return invoke<void>("browser_tab_activate", { tab });
}

export function browserTabClose(tab: string): Promise<void> {
  return invoke<void>("browser_tab_close", { tab });
}

export function browserNavigate(tab: string | null, url: string): Promise<void> {
  return invoke<void>("browser_navigate", { tab, url });
}

export function browserBack(tab: string): Promise<void> {
  return invoke<void>("browser_back", { tab });
}

export function browserForward(tab: string): Promise<void> {
  return invoke<void>("browser_forward", { tab });
}

export function browserReload(tab: string): Promise<void> {
  return invoke<void>("browser_reload", { tab });
}

export function browserContentVisible(visible: boolean): Promise<void> {
  return invoke<void>("browser_content_visible", { visible });
}
