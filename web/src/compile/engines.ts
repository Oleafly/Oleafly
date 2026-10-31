import type { BrowserEngine } from "@oleafly/compile-port";

export async function browserEngines(): Promise<readonly BrowserEngine[]> {
  if (import.meta.env.DEV && import.meta.env.VITE_OLEAFLY_FAKE_ENGINE === "1") {
    const { createFakeEngine } = await import("@oleafly/compile-port/testing");
    return [createFakeEngine()];
  }
  return [];
}
