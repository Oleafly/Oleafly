import type { BrowserEngine } from "@oleafly/compile-port";

/**
 * The engines this browser app compiles with. None ships yet. A development
 * build started with `VITE_OLEAFLY_FAKE_ENGINE=1` gets the test engine, which
 * production builds leave out.
 */
export async function browserEngines(): Promise<readonly BrowserEngine[]> {
  if (import.meta.env.DEV && import.meta.env.VITE_OLEAFLY_FAKE_ENGINE === "1") {
    const { createFakeEngine } = await import("@oleafly/compile-port/testing");
    return [createFakeEngine()];
  }
  return [];
}
