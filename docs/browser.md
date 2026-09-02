# In-app browser

The browser is its own OS window, built from one Tauri window and several child webviews. Rust owns the window and the webview set (`src-tauri/src/browser.rs`); the toolbar is our own React page (`src/components/browser/`), loaded as `index.html?view=browser`.

## Window layout

The window hosts two kinds of child webviews.

The chrome webview is our app. It is labelled `oleafly-browser-chrome-<n>` and its native bounds cover the whole window. It paints the tab strip and the address row in the top 88 logical pixels and leaves the rest as a plain surface. It is the only webview in the window that is meant to use IPC, and its capability (`src-tauri/capabilities/browser.json`) grants it event listening, event emit, and `shell:allow-open`. Every browser command in Rust also checks that the caller is the chrome webview of the window it is acting on. The open, focus, and close commands accept only the main window, and navigate accepts the chrome or the main window, which acts on the active tab of the newest browser window for computer use.

Each tab is a content webview labelled `oleafly-browser-pane-<n>`, loaded with `WebviewUrl::External` and added after the chrome so it sits above it. Its bounds start 88 logical pixels down and run to the bottom of the window. Only the active tab is shown; the others are hidden with `webview.hide()`. Remote pages get no IPC. The navigation handler allows http, https, and about:blank only, and every URL that arrives from the frontend is parsed and rejected unless it is http or https with a host. Both refuse the app's own origin, tauri.localhost and any .localhost host, and in development builds the dev server origin, because a pane on the app's origin would gain command access. Links that ask for a new window open as a new tab in the same window.

Layout is recomputed in the window's `Resized` and `ScaleFactorChanged` handlers: the chrome is set to the full inner size and every pane to the strip below the chrome, in physical pixels. Page load and title changes are app-wide events, `browser-page-load` and `browser-title`, whose intended consumers are the chrome and the main window; tab changes arrive the same way as `browser-tab-opened`, `browser-tab-closed`, and `browser-tab-activated`, and the activated event carries the tab's current URL. The chrome reads the initial tab set with `browser_state` after it subscribes, so nothing is lost if the first tab finishes before the chrome is ready. When the window is destroyed Rust emits `browser-window-closed` to the main window, which turns the toolbar toggle off.

## The overlay rule

A native child webview is always painted above anything the webview below it draws. A menu or popover that opens from the chrome and extends below the 88 pixel strip would be covered by the page. So the chrome hides the page first: before it opens any overlay it calls `browser_content_visible(false)`, which hides the active pane, and after the overlay closes it calls `browser_content_visible(true)`. `useOverlayGate` in `src/components/browser/use-overlay-gate.ts` wraps this so the overlay's open state only flips to true once the hide has been acknowledged. Because the chrome's native bounds cover the whole window, the overlay has room to render once the pane is hidden. Tooltips are placed so they stay within the 88 pixel strip (tab strip tooltips open downward, address row tooltips open upward) and do not need the gate.

While a pane is hidden for an overlay, a tab switch keeps the new tab hidden until the overlay closes, so the page never reappears under an open menu.

## Design note: a future docked mode

If the browser is later docked inside the main window, the same two ideas carry over.

A placeholder element in the React layout marks where the page should appear. A `ResizeObserver` on that element (plus a window resize listener for the window offset) reports its rect, and the app calls a command that sets the child webview's position and size to that rect in physical pixels. The webview never lives in the DOM; the placeholder only drives its bounds.

The content visibility command stays the mechanism for overlays, but the caller changes: the app's modal coordinator (dialogs, command palette, context menus, popovers, tooltips) calls `browser_content_visible(false)` whenever anything opens over the placeholder and `browser_content_visible(true)` when the last overlay closes. Counting open overlays in one place avoids one overlay's close revealing the page under another that is still open.

The known limitation is stacking. A native child webview cannot sit under other panels or panes of the app; whatever it overlaps, it wins. The dock therefore has to be a leaf in the layout with nothing else drawn over its rect apart from the overlays that the coordinator hides it for, and it cannot be partially covered by a resizable neighbour, a sidebar, or the assistant panel.
