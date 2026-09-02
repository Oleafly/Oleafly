import { useCallback, useEffect, useMemo, useReducer } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  BROWSER_EVENTS,
  browserBack,
  browserContentVisible,
  browserForward,
  browserNavigate,
  browserReload,
  browserState,
  browserTabActivate,
  browserTabClose,
  browserTabOpen,
  type BrowserLabelPayload,
  type BrowserPageLoadPayload,
  type BrowserTabClosedPayload,
  type BrowserTabOpenedPayload,
  type BrowserTitlePayload,
} from "@/lib/browser-commands";
import { BROWSER_SEARCH_ENGINES, useSettingsStore } from "@/store/settings";
import { FALLBACK_SEARCH_URL, resolveAddressInput } from "./address";
import {
  activeTab,
  EMPTY_BROWSER_STATE,
  reduceBrowser,
  type BrowserChromeState,
  type BrowserTab,
} from "./browser-state";

export interface BrowserSession {
  state: BrowserChromeState;
  tab: BrowserTab | null;
  homePage: string;
  openTab: (url?: string) => Promise<void>;
  activate: (label: string) => Promise<void>;
  close: (label: string) => Promise<void>;
  submitAddress: (input: string) => Promise<void>;
  back: () => Promise<void>;
  forward: () => Promise<void>;
  reload: () => Promise<void>;
  setContentVisible: (visible: boolean) => Promise<void>;
}

function searchUrlFor(engine: string): string {
  return BROWSER_SEARCH_ENGINES.find(({ id }) => id === engine)?.searchUrl ?? FALLBACK_SEARCH_URL;
}

function ignore(): void {}

export function useBrowserSession(): BrowserSession {
  const [state, dispatch] = useReducer(reduceBrowser, EMPTY_BROWSER_STATE);
  const searchEngine = useSettingsStore((s) => s.browserSearchEngine);
  const homePage = useSettingsStore((s) => s.browserHomePage);

  useEffect(() => {
    let disposed = false;
    const unlisteners: UnlistenFn[] = [];
    const subscribe = <T>(event: string, handler: (payload: T) => void) =>
      listen<T>(event, (e) => handler(e.payload)).then((off) => {
        if (disposed) off();
        else unlisteners.push(off);
      });
    void Promise.all([
      subscribe<BrowserTabOpenedPayload>(BROWSER_EVENTS.tabOpened, (p) =>
        dispatch({ type: "tab-opened", label: p.label, url: p.url, active: p.active }),
      ),
      subscribe<BrowserTabClosedPayload>(BROWSER_EVENTS.tabClosed, (p) =>
        dispatch({ type: "tab-closed", label: p.label, active: p.active }),
      ),
      subscribe<BrowserLabelPayload>(BROWSER_EVENTS.tabActivated, (p) =>
        dispatch({ type: "tab-activated", label: p.label }),
      ),
      subscribe<BrowserPageLoadPayload>(BROWSER_EVENTS.pageLoad, (p) =>
        dispatch({ type: "page-load", label: p.label, state: p.state, url: p.url }),
      ),
      subscribe<BrowserTitlePayload>(BROWSER_EVENTS.title, (p) =>
        dispatch({ type: "title", label: p.label, title: p.title }),
      ),
    ])
      .catch(ignore)
      .then(() => browserState())
      .then((snapshot) => {
        if (disposed) return;
        dispatch({ type: "snapshot", tabs: snapshot.tabs, active: snapshot.active });
      })
      .catch(ignore);
    return () => {
      disposed = true;
      for (const off of unlisteners) off();
    };
  }, []);

  const tab = activeTab(state);
  const active = tab?.label ?? null;

  const openTab = useCallback(
    async (url?: string) => {
      await browserTabOpen(url ?? homePage).catch(ignore);
    },
    [homePage],
  );

  const activate = useCallback(async (label: string) => {
    dispatch({ type: "tab-activated", label });
    await browserTabActivate(label).catch(ignore);
  }, []);

  const close = useCallback(async (label: string) => {
    await browserTabClose(label).catch(ignore);
  }, []);

  const submitAddress = useCallback(
    async (input: string) => {
      const url = resolveAddressInput(input, searchUrlFor(searchEngine));
      if (!url) return;
      if (!active) {
        await browserTabOpen(url).catch(ignore);
        return;
      }
      dispatch({ type: "navigating", label: active, url });
      await browserNavigate(active, url).catch(ignore);
    },
    [active, searchEngine],
  );

  const back = useCallback(async () => {
    if (active) await browserBack(active).catch(ignore);
  }, [active]);
  const forward = useCallback(async () => {
    if (active) await browserForward(active).catch(ignore);
  }, [active]);
  const reload = useCallback(async () => {
    if (active) await browserReload(active).catch(ignore);
  }, [active]);

  const setContentVisible = useCallback(async (visible: boolean) => {
    await browserContentVisible(visible);
  }, []);

  return useMemo(
    () => ({
      state,
      tab,
      homePage,
      openTab,
      activate,
      close,
      submitAddress,
      back,
      forward,
      reload,
      setContentVisible,
    }),
    [state, tab, homePage, openTab, activate, close, submitAddress, back, forward, reload, setContentVisible],
  );
}
