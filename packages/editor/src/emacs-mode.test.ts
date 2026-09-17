import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { EmacsHandler } from "@replit/codemirror-emacs";
import { describe, expect, it } from "vitest";
import { emacsModeExtension } from "./emacs-mode";

const require = createRequire(import.meta.url);

describe("Emacs mode packaging", () => {
  it("keeps the package's key table and command table alive in production bundles", () => {
    const bundle = require.resolve("@replit/codemirror-emacs").replace(/index\.cjs$/u, "index.js");
    const source = readFileSync(bundle, "utf8");
    expect(source).not.toMatch(/__PURE__\*\/\s*EmacsHandler\.(bindKey|addCommands)/u);
    expect(source).toMatch(/^EmacsHandler\.addCommands\(\{/mu);
  });

  it("registers the editor's own bindings on top of the package defaults", () => {
    emacsModeExtension();
    expect(EmacsHandler.commands.goOrSelect).toBeDefined();
    expect(EmacsHandler.commands.killRegion).toBeDefined();
  });
});
