import { describe, expect, it } from "vitest";
import {
  assertNoProductionDevHookTokens,
  assertNoTauriStyleNonceTriggers,
  findInlineStyleElementCount,
  findProductionDevHookTokens,
} from "../../scripts/production-hook-audit.mjs";
import { rejectProductionDevHooks } from "../../vite.config";

describe("production DEV-hook audit", () => {
  it("detects explicit and generic test-hook tokens", () => {
    expect(
      findProductionDevHookTokens(
        "window.__agentHandoff = fn; target.__e2ePdfText = fn; data-e2e-compile-status",
      ),
    ).toEqual([
      "__agentHandoff",
      "__e2ePdfText",
      "data-e2e-compile-status",
    ]);
  });

  it("allows framework globals that are required in production", () => {
    expect(
      findProductionDevHookTokens(
        "window.__TAURI_INTERNALS__; module.__esModule; __vite__mapDeps",
      ),
    ).toEqual([]);
  });

  it("reports every emitted artifact that leaks a hook", () => {
    expect(() =>
      assertNoProductionDevHookTokens([
        ["assets/app.js", "globalThis.__mcpQueue = fn"],
        ["assets/editor.js", "window.__chatUsageGet = fn"],
      ]),
    ).toThrow(
      "assets/app.js: __mcpQueue\nassets/editor.js: __chatUsageGet",
    );
  });
});

describe("Tauri production style CSP audit", () => {
  it("runs the HTML audit only for production builds", () => {
    expect(rejectProductionDevHooks().apply).toBe("build");
  });

  it("rejects inline style elements that would nonce style-src", () => {
    expect(findInlineStyleElementCount("<style>body{margin:0}</style>")).toBe(1);
    expect(() =>
      assertNoTauriStyleNonceTriggers([
        ["index.html", "<html><head><style>.splash{}</style></head></html>"],
      ]),
    ).toThrow("Tauri nonce style-src and block CodeMirror runtime styles");
  });

  it("allows blocking external stylesheets and non-HTML assets", () => {
    expect(
      findInlineStyleElementCount("<!-- an inline <style> would be unsafe -->"),
    ).toBe(0);
    expect(() =>
      assertNoTauriStyleNonceTriggers([
        ["index.html", '<link rel="stylesheet" href="/assets/app.css">'],
        ["assets/app.js", 'const example = "<style>"'],
      ]),
    ).not.toThrow();
  });
});
