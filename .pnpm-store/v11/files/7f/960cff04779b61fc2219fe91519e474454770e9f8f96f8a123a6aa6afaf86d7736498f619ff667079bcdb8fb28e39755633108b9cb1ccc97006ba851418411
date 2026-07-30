# tauri-playwright

Playwright E2E testing for Tauri desktop apps. Controls the real native webview (WKWebView, WebView2, WebKitGTK) with a Playwright-compatible API — auto-waiting, locator assertions, semantic selectors, network mocking, native screenshots, and video recording.

## The Problem

Tauri apps use system webviews instead of Chromium. Playwright requires Chrome DevTools Protocol (CDP), but only WebView2 (Windows) supports it. **Standard Playwright integration is impossible on macOS and Linux.**

## The Solution

Three testing modes from the same test files:

| Mode | Platform | How it works |
|---|---|---|
| `browser` | All | Headless Chromium with mocked Tauri IPC. Fast, CI-friendly. |
| `tauri` | All | Socket bridge to the real Tauri webview. True E2E. |
| `cdp` | Windows | Direct CDP to WebView2. Full native Playwright. |

```
┌──────────────────┐  socket/JSON  ┌──────────────────────────────────┐
│  Playwright       │◄────────────►│  tauri-plugin-playwright          │
│  test runner      │              │  (Rust, embedded in your app)     │
│                   │              │                                   │
│  @srsholmes/      │              │  Socket server → JS injection     │
│  tauri-playwright │              │  HTTP polling  ← JS results       │
└──────────────────┘              └──────────────────────────────────┘
```

## Quick Start

### 1. Add the Rust plugin to your Tauri app

```toml
# src-tauri/Cargo.toml
[features]
e2e-testing = ["tauri-plugin-playwright"]

[dependencies]
tauri-plugin-playwright = { version = "0.1", optional = true }
```

```rust
// src-tauri/src/lib.rs
pub fn run() {
    let mut builder = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![/* your commands */]);

    #[cfg(feature = "e2e-testing")]
    {
        builder = builder.plugin(tauri_plugin_playwright::init());
    }

    builder.run(tauri::generate_context!()).expect("error running app");
}
```

### 2. Install the npm package

```bash
pnpm add -D @srsholmes/tauri-playwright @playwright/test
npx playwright install chromium
```

### 3. Create test fixtures

```ts
// e2e/fixtures.ts
import { createTauriTest } from '@srsholmes/tauri-playwright';

export const { test, expect } = createTauriTest({
  devUrl: 'http://localhost:1420',
  ipcMocks: {
    greet: (args) => `Hello, ${(args as { name?: string })?.name}!`,
  },
  mcpSocket: '/tmp/tauri-playwright.sock',
});
```

### 4. Write tests

```ts
// e2e/tests/app.spec.ts
import { test, expect } from '../fixtures';

test('counter increments', async ({ tauriPage }) => {
  await tauriPage.click('[data-testid="btn-increment"]');
  await expect(tauriPage.locator('[data-testid="counter-value"]')).toContainText('1');
});

test('greets via Tauri IPC', async ({ tauriPage }) => {
  await tauriPage.fill('[data-testid="greet-input"]', 'World');
  await tauriPage.click('[data-testid="btn-greet"]');
  await expect(tauriPage.getByTestId('greet-result')).toContainText('Hello, World!');
});
```

### 5. Configure Playwright

```ts
// e2e/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  projects: [
    {
      name: 'browser-only',
      use: { ...devices['Desktop Chrome'], mode: 'browser' },
    },
    {
      name: 'tauri',
      use: { mode: 'tauri' },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    port: 1420,
    reuseExistingServer: !process.env.CI,
  },
});
```

### 6. Run tests

```bash
# Browser mode (headless, no Tauri needed)
npx playwright test --project=browser-only

# Tauri mode (start the app first)
cargo tauri dev --features e2e-testing  # Terminal 1
npx playwright test --project=tauri      # Terminal 2
```

## API Reference

### Page Methods

All actions auto-wait for the element to be visible and enabled (default 5s timeout, configurable).

#### Interactions

```ts
await tauriPage.click(selector, { timeout? })
await tauriPage.dblclick(selector)
await tauriPage.hover(selector)
await tauriPage.fill(selector, text)
await tauriPage.type(selector, text)            // character by character
await tauriPage.press(selector, 'Enter')
await tauriPage.check(selector)
await tauriPage.uncheck(selector)
await tauriPage.selectOption(selector, value)
await tauriPage.focus(selector)
await tauriPage.blur(selector)
await tauriPage.dragAndDrop(source, target)
await tauriPage.dispatchEvent(selector, 'custom-event')
```

#### Queries (auto-wait for element)

```ts
const text = await tauriPage.textContent(selector)
const html = await tauriPage.innerHTML(selector)
const visible = await tauriPage.innerText(selector)
const value = await tauriPage.inputValue(selector)
const attr = await tauriPage.getAttribute(selector, name)
const box = await tauriPage.boundingBox(selector)
const css = await tauriPage.getComputedStyle(selector, 'color')
const all = await tauriPage.allTextContents(selector)
```

#### State Checks (instant, no waiting)

```ts
await tauriPage.isVisible(selector)     // false if not found
await tauriPage.isHidden(selector)
await tauriPage.isChecked(selector)
await tauriPage.isDisabled(selector)
await tauriPage.isEnabled(selector)
await tauriPage.isEditable(selector)
await tauriPage.isFocused(selector)
await tauriPage.count(selector)         // 0 if none found
```

#### Navigation

```ts
await tauriPage.goto(url)
await tauriPage.reload()
await tauriPage.goBack()
await tauriPage.goForward()
await tauriPage.waitForURL('/dashboard')
const title = await tauriPage.title()
const url = await tauriPage.url()
const html = await tauriPage.content()
```

#### Waiting

```ts
await tauriPage.waitForSelector(selector, timeout?)
await tauriPage.waitForFunction('document.readyState === "complete"', timeout?)
await tauriPage.waitForURL('/dashboard', { timeout: 10000 })
```

#### Evaluate

```ts
const result = await tauriPage.evaluate<number>('window.innerWidth')
```

### Semantic Selectors

```ts
tauriPage.getByTestId('submit')
tauriPage.getByText('Hello World')
tauriPage.getByRole('button', { name: 'Submit' })
tauriPage.getByLabel('Email')
tauriPage.getByPlaceholder('Enter name')
tauriPage.getByAltText('Logo')
tauriPage.getByTitle('Close')
```

### Locator API

```ts
const locator = tauriPage.locator('[data-testid="list"]')

// Actions
await locator.click()
await locator.fill('text')
await locator.press('Enter')
await locator.clear()
await locator.pressSequentially('hello', { delay: 50 })
await locator.dispatchEvent('input')

// Queries
await locator.textContent()
await locator.innerText()
await locator.inputValue()
await locator.getAttribute('href')
await locator.evaluate('(el) => el.dataset.custom')

// State
await locator.isVisible()
await locator.isChecked()
await locator.isFocused()

// Refinement
locator.nth(2)
locator.first()
locator.last()
locator.filter({ hasText: 'Active' })
await locator.all()            // returns array of locators

// Nesting
locator.locator('.child')
locator.getByTestId('item')
locator.getByText('Click me')

// Scrolling
await locator.scrollIntoViewIfNeeded()
```

### Assertions

Custom `expect` matchers with auto-retry (default 5s timeout):

```ts
// Visibility
await expect(locator).toBeVisible()
await expect(locator).toBeHidden()
await expect(locator).not.toBeVisible()

// Content
await expect(locator).toContainText('Hello')
await expect(locator).toContainText(/hello/i)    // regex
await expect(locator).toHaveText('Hello World')  // exact match

// Form state
await expect(locator).toHaveValue('test')
await expect(locator).toBeChecked()
await expect(locator).toBeEnabled()
await expect(locator).toBeDisabled()
await expect(locator).toBeEditable()
await expect(locator).toBeFocused()
await expect(locator).toBeEmpty()

// Attributes
await expect(locator).toHaveAttribute('type', 'text')
await expect(locator).toHaveClass('active')
await expect(locator).toHaveCSS('color', 'rgb(255, 0, 0)')
await expect(locator).toHaveId('main')

// Collections
await expect(locator).toHaveCount(5)
await expect(locator).toBeAttached()

// Page-level
await expect(tauriPage).toHaveURL('/dashboard')
await expect(tauriPage).toHaveTitle('My App')
```

### Keyboard & Mouse

```ts
// Keyboard
await tauriPage.keyboard.press('Enter')
await tauriPage.keyboard.press('Control+A')
await tauriPage.keyboard.type('hello world', { delay: 50 })
await tauriPage.keyboard.down('Shift')
await tauriPage.keyboard.up('Shift')

// Mouse
await tauriPage.mouse.click(100, 200)
await tauriPage.mouse.click(100, 200, { button: 'right' })
await tauriPage.mouse.dblclick(100, 200)
await tauriPage.mouse.move(300, 400)
await tauriPage.mouse.wheel(0, 100)
```

### Network Mocking

```ts
// Mock an API endpoint
await tauriPage.route('/api/users', {
  status: 200,
  body: JSON.stringify({ users: ['Alice', 'Bob'] }),
  contentType: 'application/json',
});

// Click a button that fetches from the mocked endpoint
await tauriPage.click('[data-testid="fetch-btn"]');
await expect(tauriPage.getByTestId('user-0')).toContainText('Alice');

// Verify network requests were captured
const requests = await tauriPage.getNetworkRequests();
expect(requests.find(r => r.url.includes('/api/users'))).toBeTruthy();

// Clean up
await tauriPage.unroute('/api/users');
await tauriPage.clearRoutes();
```

### Dialog Handling

```ts
await tauriPage.installDialogHandler({
  defaultConfirm: true,
  defaultPromptText: 'Claude',
});

await tauriPage.click('[data-testid="btn-confirm"]');

const dialogs = await tauriPage.getDialogs();
expect(dialogs[0].type).toBe('confirm');
expect(dialogs[0].message).toBe('Are you sure?');
```

### File Upload

```ts
await tauriPage.setInputFiles('[data-testid="file-input"]', [
  { name: 'test.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') },
]);
```

### Screenshots & Video

```ts
// Native screenshot (CoreGraphics on macOS — captures real window with title bar)
const png = await tauriPage.screenshot();
await tauriPage.screenshot({ path: '/tmp/screenshot.png' });

// Video recording (native frame capture → ffmpeg → MP4)
await tauriPage.startRecording({ path: '/tmp/recording', fps: 15 });
// ... run test actions ...
const result = await tauriPage.stopRecording();
console.log(result.video); // '/tmp/recording/video.mp4'
```

The fixture automatically records video and captures screenshots on failure, attaching them to the Playwright HTML report.

### IPC Mocking (Browser Mode)

Mock any Tauri `invoke()` command, including plugin commands:

```ts
createTauriTest({
  devUrl: 'http://localhost:1420',
  ipcMocks: {
    greet: (args) => `Hello, ${args?.name}!`,
    get_config: () => ({ theme: 'dark', lang: 'en' }),
    'plugin:fs|read': () => 'file contents',
    'plugin:dialog|open': () => '/path/to/file',
  },
});
```

Assert which IPC commands were called:

```ts
import { getCapturedInvokes, clearCapturedInvokes } from '@srsholmes/tauri-playwright';

const calls = await getCapturedInvokes(tauriPage);
expect(calls).toContainEqual(
  expect.objectContaining({ cmd: 'greet', args: { name: 'World' } })
);
```

## Plugin Configuration

```rust
use tauri_plugin_playwright::PluginConfig;

// Default: Unix socket at /tmp/tauri-playwright.sock
builder = builder.plugin(tauri_plugin_playwright::init());

// Custom socket path + TCP fallback
builder = builder.plugin(tauri_plugin_playwright::init_with_config(
    PluginConfig::new()
        .socket_path("/tmp/my-app-pw.sock")
        .tcp_port(6274)
));
```

## CDP Mode (Windows)

On Windows, WebView2 supports Chrome DevTools Protocol for full native Playwright:

```bash
# Launch with CDP enabled
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" cargo tauri dev
```

```ts
// Playwright config
{
  name: 'cdp',
  use: { mode: 'cdp' },
}

// Fixture config
createTauriTest({
  cdpEndpoint: 'http://localhost:9222',
  // ...
});
```

## Example App

See [`examples/hello-world/`](examples/hello-world/) for a complete working example with:

- React frontend with counter, greet (Tauri IPC), todo list, modal, file upload, dialogs, drag & drop, API fetch
- Rust backend with greet command + playwright plugin
- **67 E2E tests** across 10 spec files covering every API method
- **127 unit tests** for the TypeScript library
- Playwright config with browser-only and Tauri projects

## Requirements

- **Tauri 2.0** with `"withGlobalTauri": true` in `tauri.conf.json`
- **Node.js 18+**
- **Rust toolchain** (for Tauri mode)
- **ffmpeg** (optional, for video stitching)
- **Screen recording permission** on macOS (for native screenshots)

## CI/CD

GitHub Actions workflow included (`.github/workflows/e2e.yml`):

```yaml
# Browser-only tests run on ubuntu (fast, headless)
npx playwright test --project=browser-only

# Tauri tests run on macOS (real app, native screenshots)
npx playwright test --project=tauri
```

Test results, HTML reports, and videos are uploaded as artifacts.

## License

MIT
