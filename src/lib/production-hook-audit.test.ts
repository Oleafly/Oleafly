import { describe, expect, it } from "vitest";
import {
  assertNoProductionDevHookTokens,
  assertNoTauriStyleNonceTriggers,
  assertStyleSrcAllowsRuntimeStyles,
  findInlineStyleElementCount,
  findProductionDevHookTokens,
  findStyleSrcDirective,
} from "../../scripts/production-hook-audit.mjs";
import tauriConfig from "../../src-tauri/tauri.conf.json";
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

// The packaged-app e2e that exercises this at runtime only runs against a
// `tauri build` binary, so on ordinary CI it skips. These assertions are what
// actually guard the shipped policy on every commit.
describe("Tauri CSP permits CodeMirror's runtime stylesheet", () => {
  const shippedCsp = (
    tauriConfig as { app: { security: { csp: string } } }
  ).app.security.csp;

  it("keeps 'unsafe-inline' in the shipped style-src", () => {
    expect(findStyleSrcDirective(shippedCsp)).toContain("'unsafe-inline'");
    expect(() => assertStyleSrcAllowsRuntimeStyles(shippedCsp)).not.toThrow();
  });

  it("rejects a style-src that drops 'unsafe-inline'", () => {
    expect(() =>
      assertStyleSrcAllowsRuntimeStyles("default-src 'self'; style-src 'self'"),
    ).toThrow("does not allow 'unsafe-inline'");
  });

  it("rejects a nonce, which makes CSP ignore 'unsafe-inline'", () => {
    expect(() =>
      assertStyleSrcAllowsRuntimeStyles(
        "style-src 'self' 'unsafe-inline' 'nonce-abc123'",
      ),
    ).toThrow("blocks CodeMirror's un-nonced runtime stylesheet");
  });

  it("rejects a policy with no style-src at all", () => {
    expect(() => assertStyleSrcAllowsRuntimeStyles("default-src 'self'")).toThrow(
      "no style-src directive",
    );
    expect(findStyleSrcDirective("")).toBeNull();
  });
});
