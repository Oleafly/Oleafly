import { test, expect } from "../fixtures";

test("asynchronous app predicates are polled until they resolve true", async ({ tauriPage }) => {
  await tauriPage.evaluate("window.__e2eAsyncPollCount = 0");
  await tauriPage.waitForFunction("Promise.resolve(++window.__e2eAsyncPollCount >= 3)", 5_000);
  expect(await tauriPage.evaluate("window.__e2eAsyncPollCount")).toBe(3);

  await tauriPage.evaluate("window.__e2eAsyncPollCount = 0");
  await tauriPage.waitForFunction(`(++window.__e2eAsyncPollCount < 3)
    ? Promise.reject(new Error('not ready')) : Promise.resolve(true)`, 5_000);
  expect(await tauriPage.evaluate("window.__e2eAsyncPollCount")).toBe(3);
  await expect(tauriPage.waitForFunction("Promise.resolve(false)", 250)).rejects.toThrow(/timeout/);
  await tauriPage.evaluate("delete window.__e2eAsyncPollCount");
});
