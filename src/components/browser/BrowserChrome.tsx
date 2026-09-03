import { useCallback, useEffect, useRef } from "react";
import { emit } from "@tauri-apps/api/event";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { BROWSER_EVENTS } from "@/lib/browser-commands";
import { useSettingsStore } from "@/store/settings";
import { AddressBar } from "./AddressBar";
import { TabStrip } from "./TabStrip";
import { useBrowserSession } from "./use-browser-session";
import { useOverlayGate } from "./use-overlay-gate";

export const BROWSER_CHROME_HEIGHT = 88;

function isModifier(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey;
}

export function BrowserChrome() {
  const session = useBrowserSession();
  const gate = useOverlayGate(session.setContentVisible);
  const addressRef = useRef<HTMLInputElement | null>(null);
  const { tab, openTab, close, reload } = session;
  const url = tab?.url ?? "";

  const copyUrl = useCallback(() => {
    if (!url) return;
    void navigator.clipboard?.writeText(url).catch(() => {});
  }, [url]);

  const openInSystemBrowser = useCallback(() => {
    if (!url) return;
    void openExternal(url).catch(() => {});
  }, [url]);

  const setHomePage = useCallback(() => {
    if (!url) return;
    useSettingsStore.getState().setBrowserHomePage(url);
    void emit(BROWSER_EVENTS.homePage, { url }).catch(() => {});
  }, [url]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isModifier(event) || event.altKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key === "l") {
        event.preventDefault();
        addressRef.current?.focus();
      } else if (key === "t") {
        event.preventDefault();
        void openTab();
      } else if (key === "w") {
        event.preventDefault();
        if (tab) void close(tab.label);
      } else if (key === "r") {
        event.preventDefault();
        void reload();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tab, openTab, close, reload]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <header
        data-testid="browser-chrome"
        className="flex shrink-0 flex-col"
        style={{ height: BROWSER_CHROME_HEIGHT }}
      >
        <TabStrip
          tabs={session.state.tabs}
          active={session.state.active}
          onActivate={(label) => void session.activate(label)}
          onClose={(label) => void close(label)}
          onNewTab={() => void openTab()}
        />
        <AddressBar
          tab={tab}
          gate={gate}
          addressRef={addressRef}
          onBack={() => void session.back()}
          onForward={() => void session.forward()}
          onReload={() => void reload()}
          onSubmit={(input) => void session.submitAddress(input)}
          onOpenExternal={openInSystemBrowser}
          onCopyUrl={copyUrl}
          onSetHomePage={setHomePage}
          onNewTab={() => void openTab()}
        />
      </header>
      <div className="flex-1 bg-muted/30" aria-hidden />
    </div>
  );
}
