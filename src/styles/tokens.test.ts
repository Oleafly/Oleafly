import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tokens = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
const globals = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

const FAMILIES = [
  "text",
  "surface",
  "border",
  "accent",
  "danger",
  "success",
  "warn",
] as const;
const STEPS = ["primary", "secondary", "tertiary"] as const;

describe("oleafly design tokens", () => {
  it("defines every semantic family at all three steps", () => {
    for (const family of FAMILIES) {
      for (const step of STEPS) {
        expect(tokens).toContain(`--oleafly-${family}-${step}:`);
      }
    }
  });

  it("scopes light and dark palettes to both the class and data-theme hooks", () => {
    expect(tokens).toMatch(/:root[^{]*\[data-theme="light"\]/);
    expect(tokens).toMatch(/\.dark[^{]*\[data-theme="dark"\]/);
  });

  it("ports the reference primitive ramp", () => {
    expect(tokens).toContain("--oleafly-gray-900: #181818");
    expect(tokens).toContain("--oleafly-gray-150: #dfdfdf");
    expect(tokens).toContain("--oleafly-blue-300: #339cff");
    expect(tokens).toContain("--oleafly-red-500: #e02e2a");
    expect(tokens).toContain("--oleafly-green-500: #00a240");
    expect(tokens).toContain("--oleafly-orange-500: #e25507");
  });

  it("derives secondary and tertiary text from the primary via oklab mixes", () => {
    expect(tokens).toContain(
      "--oleafly-text-secondary: color-mix(in oklab, var(--oleafly-text-primary) 70%, transparent)",
    );
    expect(tokens).toContain(
      "--oleafly-text-tertiary: color-mix(in oklab, var(--oleafly-text-primary) 50%, transparent)",
    );
  });

  it("declares radius, spacing, motion, and elevation scales", () => {
    for (const name of [
      "--oleafly-radius-xs:",
      "--oleafly-radius-xl:",
      "--oleafly-radius-full: 9999px",
      "--oleafly-spacing: 0.25rem",
      "--oleafly-duration-basic: 0.15s",
      "--oleafly-duration-relaxed: 0.3s",
      "--oleafly-ease-enter-snappy: cubic-bezier(0.23, 1, 0.32, 1)",
      "--oleafly-shadow-hairline:",
      "--oleafly-shadow-xl:",
    ]) {
      expect(tokens).toContain(name);
    }
  });

  it("zeroes the motion tokens under prefers-reduced-motion", () => {
    expect(tokens).toContain("@media (prefers-reduced-motion: reduce)");
    expect(tokens).toContain("--oleafly-duration-basic: 0s");
    expect(tokens).toContain("--oleafly-duration-relaxed: 0s");
  });

  it("maps Tailwind utilities onto the tokens", () => {
    for (const mapping of [
      "--color-surface: var(--oleafly-surface-primary)",
      "--color-surface-secondary: var(--oleafly-surface-secondary)",
      "--color-danger: var(--oleafly-danger-primary)",
      "--color-success: var(--oleafly-success-primary)",
      "--color-warn: var(--oleafly-warn-primary)",
      "--color-border-strong: var(--oleafly-border-secondary)",
      "--color-border-subtle: var(--oleafly-border-tertiary)",
    ]) {
      expect(tokens).toContain(mapping);
    }
  });

  it("is imported by the app stylesheet, which reads the shell palette from it", () => {
    expect(globals).toContain('@import "./tokens.css"');
    expect(globals).toContain("--background: var(--oleafly-surface-primary)");
    expect(globals).toContain("--foreground: var(--oleafly-text-primary)");
    expect(globals).toContain("--border: var(--oleafly-border-primary)");
  });
});
