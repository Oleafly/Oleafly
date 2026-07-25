import { describe, expect, it } from "vitest";
import {
  assertNoProductionDevHookTokens,
  findProductionDevHookTokens,
} from "../../scripts/production-hook-audit.mjs";

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
