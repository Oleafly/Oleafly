import type { BrowserTabInfo } from "@/lib/browser-commands";

export type BrowserTab = BrowserTabInfo;

export interface BrowserChromeState {
  tabs: BrowserTab[];
  active: string | null;
}

export type BrowserAction =
  | { type: "snapshot"; tabs: BrowserTab[]; active: string | null }
  | { type: "tab-opened"; label: string; url: string; active: boolean }
  | { type: "tab-closed"; label: string; active: string | null }
  | { type: "tab-activated"; label: string }
  | { type: "page-load"; label: string; state: "started" | "finished"; url: string }
  | { type: "title"; label: string; title: string }
  | { type: "navigating"; label: string; url: string };

export const EMPTY_BROWSER_STATE: BrowserChromeState = { tabs: [], active: null };

function patchTab(
  state: BrowserChromeState,
  label: string,
  patch: Partial<BrowserTab>,
): BrowserChromeState {
  if (!state.tabs.some((tab) => tab.label === label)) return state;
  return {
    ...state,
    tabs: state.tabs.map((tab) => (tab.label === label ? { ...tab, ...patch } : tab)),
  };
}

export function reduceBrowser(
  state: BrowserChromeState,
  action: BrowserAction,
): BrowserChromeState {
  switch (action.type) {
    case "snapshot": {
      const known = new Set(action.tabs.map((tab) => tab.label));
      const extra = state.tabs.filter((tab) => !known.has(tab.label));
      const tabs = [...action.tabs, ...extra];
      const active =
        action.active && tabs.some((tab) => tab.label === action.active)
          ? action.active
          : state.active && tabs.some((tab) => tab.label === state.active)
            ? state.active
            : (tabs[0]?.label ?? null);
      return { tabs, active };
    }
    case "tab-opened": {
      if (state.tabs.some((tab) => tab.label === action.label)) {
        return action.active ? { ...state, active: action.label } : state;
      }
      const tab: BrowserTab = {
        label: action.label,
        url: action.url,
        title: "",
        loading: true,
      };
      return {
        tabs: [...state.tabs, tab],
        active: action.active || !state.active ? action.label : state.active,
      };
    }
    case "tab-closed": {
      const tabs = state.tabs.filter((tab) => tab.label !== action.label);
      if (tabs.length === state.tabs.length) return state;
      const requested = action.active;
      const active =
        requested && tabs.some((tab) => tab.label === requested)
          ? requested
          : state.active && state.active !== action.label && tabs.some((tab) => tab.label === state.active)
            ? state.active
            : (tabs[0]?.label ?? null);
      return { tabs, active };
    }
    case "tab-activated":
      if (!state.tabs.some((tab) => tab.label === action.label)) return state;
      return state.active === action.label ? state : { ...state, active: action.label };
    case "page-load":
      return patchTab(state, action.label, {
        url: action.url,
        loading: action.state === "started",
      });
    case "title":
      return patchTab(state, action.label, { title: action.title });
    case "navigating":
      return patchTab(state, action.label, { url: action.url, loading: true, title: "" });
    default:
      return state;
  }
}

export function activeTab(state: BrowserChromeState): BrowserTab | null {
  if (!state.active) return null;
  return state.tabs.find((tab) => tab.label === state.active) ?? null;
}
