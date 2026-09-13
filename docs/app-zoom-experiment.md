# App zoom experiment

Status: Deferred. This page records the proposed experiment. Released builds
do not provide this behavior, and any first implementation must remain off by
default until the acceptance checks below pass.

## What exists today

The "App font size" setting is not app-level zoom. It changes the root font
size in the main React application, with choices from 13 to 20 pixels. The
editor has its own font-size variable, and the terminal and PDF viewer have
separate controls. The detached preview, browser chrome, and update window do
not mount the main `App` component, so they keep their own scale.

The relevant code is in
[`AppearanceSection.tsx`](../src/components/settings/AppearanceSection.tsx),
[`App.tsx`](../src/App.tsx), and [`main.tsx`](../src/main.tsx). PDF keyboard
zoom is handled separately in
[`PreviewPane.tsx`](../src/components/preview/PreviewPane.tsx).

For that reason, Oleafly has no supported path for resizing the full app
interface to 200 percent. The existing font setting should keep its current
name and purpose during this experiment.

## User-facing contract

When the experiment is enabled:

- Zoom is stored as an integer percentage. The allowed levels are 80, 90, 100,
  110, 125, 150, 175, and 200 percent.
- View > Zoom In, Zoom Out, and Actual Size control one app-wide level.
  Cmd/Ctrl `+`, `-`, and `0` invoke the same actions from any Oleafly-owned
  webview.
- The selected level persists across restarts. A newly opened Oleafly window
  starts at that level without a visible jump from 100 percent.
- Zoom applies to Oleafly-owned webviews: the main window, detached preview,
  update window, and the browser's local chrome. It also scales the editor and
  terminal because they live inside the main webview.
- External pages in `oleafly-browser-pane-*` webviews remain at their own page
  scale. A future app-owned webview must opt in explicitly; the default is not
  to zoom it.

Do not enable Tauri's automatic zoom hotkeys. The PDF viewer already uses the
same shortcuts. While this experiment is on, app zoom owns Cmd/Ctrl `+`, `-`,
and `0`; PDF zoom remains available from its toolbar. The current PDF shortcut
behavior returns when the experiment is off. One key press must never change
both scales.

## Implementation boundary

Put the native behavior in a new `src-tauri/src/app_zoom.rs` module. Rust owns
the effective level and calls Tauri's `Webview::set_zoom`; the frontend should
not receive a general set-zoom permission. Keep that permission out of
[`default.json`](../src-tauri/capabilities/default.json).

Menu clicks, keyboard shortcuts, and the Settings UI should all call the same
Rust setter:

1. Add `app_zoom_enabled: bool` and `app_zoom_percent: u16` to `AppConfig`.
   Existing configurations default to `false` and `100`.
2. Validate the percentage against the fixed level list. Reject fractional,
   out-of-range, and unknown values instead of rounding them.
3. Accept setting changes only from the main app webview or a native menu
   event. Enumerate registered Oleafly-owned webviews and call
   `set_zoom(percent as f64 / 100.0)` on each one. Never include an external
   browser pane in that registry.
4. Persist the new level only after every eligible webview accepts it. If one
   fails, restore the previous level on webviews that already changed and keep
   the previous stored value. Return a usable error to the settings UI.
5. Apply the stored level as part of each trusted webview's creation. Create
   detached windows hidden, apply zoom, then show them. Apply the main window's
   level during Tauri setup before its content is revealed.

The frontend setting reads the Rust snapshot and sends a requested level back
through this narrow command. The Rust snapshot remains the source of truth.

### Browser chrome geometry

The browser window places an external page below an 88-logical-pixel local
chrome strip. Zooming only the chrome without moving the page would make the
two surfaces overlap. Keep the current constant as its 100-percent base, then
reserve:

```text
chrome physical height = 88 * OS scale factor * app zoom percentage / 100
```

Store the active app zoom with the browser window state. Re-run
`apply_layout` after a zoom change and use the same value for later resize and
tab-open events. Unit tests should cover fractional display scale, 200 percent,
and a window shorter than the scaled chrome.

### Supported macOS versions

Oleafly currently declares macOS 10.15 as its minimum. Tauri's native
[`set_zoom`](https://docs.rs/tauri/latest/tauri/webview/struct.Webview.html#method.set_zoom)
support starts at macOS 11. On macOS 10.15, the experiment must remain
unavailable and the app must stay at 100 percent without repeated errors.
Shipping this beyond an experiment requires a separate decision: retain 10.15
with no app zoom there, or raise the minimum supported version. This change
must not raise the minimum silently.

## Acceptance checks

The experiment is ready for wider use only when all of these are recorded for
the same commit:

- Rust tests cover the allowed levels, caller checks, default-deny webview
  registration, rollback after a failed apply, and browser geometry.
- Browser tests exercise the menu commands and Cmd/Ctrl shortcuts at 80, 100,
  and 200 percent. They verify restart persistence, reset to Actual Size, and
  inheritance by windows opened after the change.
- At 200 percent, every app-owned control remains reachable by keyboard or
  scrolling at both the 900 by 600 minimum window and the 1280 by 800 default.
  Text, menus, dialogs, popovers, focus indicators, and error messages must not
  be clipped, hidden behind fixed regions, or made impossible to operate.
- Main, preview, update, and browser-chrome windows each have an automated
  geometry assertion and a visual capture at 100 and 200 percent. The external
  browser page stays unzoomed and begins below the scaled chrome.
- With the PDF preview focused, each app-zoom shortcut changes the app level
  once and leaves the PDF viewer's own percentage unchanged. Its toolbar zoom
  still works.
- The 200-percent pass covers the default app font size first. It also records
  the supported combinations with 13- and 20-pixel app text so two independent
  settings cannot hide controls when combined.
- Native checks run on Windows, Linux, macOS 11 or newer, and the macOS 10.15
  unavailable path. A browser-only test cannot prove the native webview result.

These checks are the evidence needed to evaluate
[WCAG 2.2 success criterion 1.4.4](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html)
for Oleafly's own interface. Passing them does not establish full WCAG
conformance or the separate Reflow criterion, which needs its own narrow-
viewport test plan.

## Rollout and rollback

Start with an Experimentation toggle that is off for existing and new users.
Use it for native testing before exposing zoom in Appearance settings. The View
menu items and their accelerators should appear only when the current platform
supports the experiment.

Turning the flag off is also the rollback path. It must set every registered
app-owned webview back to 100 percent, remove the app-zoom menu accelerators,
and restore the existing PDF shortcut behavior. The stored preference can be
retained for a later retry, but it has no effect while the flag is off.

This experiment does not change document layout, exported files, or the PDF
viewer's stored zoom. It does not promise scaling for third-party web content,
replace the editor and terminal font settings, or claim accessibility
compliance before the native and no-loss checks pass.
