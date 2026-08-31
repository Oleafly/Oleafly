import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

describe("desktop scrollbars", () => {
  it("styles every application scroll surface", () => {
    expect(styles).toContain(":where(body, body *)");
    expect(styles).toContain("scrollbar-width: thin");
    expect(styles).toContain(":where(body, body *)::-webkit-scrollbar");
    expect(styles).toContain("width: 6px");
    expect(styles).toContain("height: 6px");
    expect(styles).toContain(":where(body, body *):hover::-webkit-scrollbar-thumb");
  });
});

describe("assistant mascot motion", () => {
  it("animates only the blink with a reduced-motion fallback", () => {
    expect(styles).toContain("@keyframes oleafly-assistant-blink");
    expect(styles).toContain("@keyframes oleafly-assistant-hover-blink");
    expect(styles).not.toContain("@keyframes oleafly-assistant-nod");
    expect(styles).toContain(".oleafly-assistant-mascot-blink");
    expect(styles).toContain("clip-path: inset(35.5% 39.5% 50.5% 33%)");
    expect(styles).toContain(
      "animation: oleafly-assistant-blink 2s steps(1, end) infinite",
    );
    expect(styles).toContain(
      ".oleafly-assistant-mascot:hover .oleafly-assistant-mascot-blink",
    );
    expect(styles).toContain(
      "animation: oleafly-assistant-hover-blink 320ms linear 1",
    );
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain("animation: none");
  });
});

describe("assistant composer container queries", () => {
  it("shows labels by default and collapses them right-to-left as space narrows", () => {
    const personaBreakpoint = styles.indexOf(
      "@container ai-composer (max-width: 38rem)",
    );
    const promptsBreakpoint = styles.indexOf(
      "@container ai-composer (max-width: 34rem)",
    );
    const approvalBreakpoint = styles.indexOf(
      "@container ai-composer (max-width: 31rem)",
    );

    expect(personaBreakpoint).toBeGreaterThan(-1);
    expect(promptsBreakpoint).toBeGreaterThan(personaBreakpoint);
    expect(approvalBreakpoint).toBeGreaterThan(promptsBreakpoint);
    const personaRules = styles.slice(personaBreakpoint, promptsBreakpoint);
    const promptsRules = styles.slice(promptsBreakpoint, approvalBreakpoint);
    const approvalRules = styles.slice(
      approvalBreakpoint,
      styles.indexOf("@container ai-composer (max-width: 28rem)"),
    );

    expect(personaRules).toMatch(/\.ai-composer-persona-value\s*\{\s*display: none;/u);
    expect(personaRules).toMatch(/\.ai-composer-persona-trigger\s*\{[^}]*width: 2\.5rem;/su);
    expect(promptsRules).toMatch(/\.ai-composer-prompts-value\s*\{\s*display: none;/u);
    expect(promptsRules).toMatch(/\.ai-composer-prompts-icon\s*\{\s*display: block;/u);
    expect(promptsRules).toMatch(/\.ai-composer-prompts-trigger\s*\{[^}]*width: 2\.5rem;/su);
    expect(approvalRules).toMatch(/\.ai-composer-approval-value\s*\{\s*display: none;/u);
    expect(approvalRules).toMatch(
      /\.ai-composer-approval-trigger\s*\{[^}]*width: 3rem;[^}]*gap: 0\.125rem;[^}]*padding-left: 0\.5rem;[^}]*padding-right: 0\.25rem;/su,
    );
    expect(styles.match(/\.ai-composer-persona-value\s*\{[^}]*display:\s*none;/gsu)).toHaveLength(1);
    expect(styles.match(/\.ai-composer-prompts-value\s*\{[^}]*display:\s*none;/gsu)).toHaveLength(1);
    expect(styles.match(/\.ai-composer-approval-value\s*\{[^}]*display:\s*none;/gsu)).toHaveLength(1);
    expect(styles).not.toContain(
      ".ai-composer-persona .ai-composer-persona-trigger > svg:last-child",
    );
  });

  it("compacts persistent controls before the narrow horizontal-scroll fallback", () => {
    const compactBreakpoint = styles.indexOf(
      "@container ai-composer (max-width: 24rem)",
    );
    const compactRules = styles.slice(
      compactBreakpoint,
      styles.indexOf("@media (prefers-reduced-motion: reduce)", compactBreakpoint),
    );

    expect(compactBreakpoint).toBeGreaterThan(-1);
    expect(compactRules).toMatch(
      /\.ai-composer-controls-left,\s*\.ai-composer-controls-right\s*\{\s*gap: 0\.125rem;/u,
    );
    expect(compactRules).toMatch(
      /\.ai-composer-attach,\s*\.ai-composer-plan,\s*\.ai-composer-figure,\s*\.ai-composer-mic\s*\{[^}]*width: 1\.5rem;/su,
    );
    expect(compactRules).toMatch(/\.ai-composer-attach[^}]*width: 1\.5rem;/su);
    expect(compactRules).toMatch(
      /\.ai-composer-approval-trigger[^}]*width: 2\.75rem;[^}]*padding-left: 0\.375rem;[^}]*padding-right: 0\.125rem;/su,
    );
    expect(compactRules).toMatch(/\.ai-composer-prompts-trigger[^}]*width: 1\.5rem;/su);
    expect(compactRules).toMatch(/\.ai-composer-prompts-chevron\s*\{\s*display: none;/u);
    expect(compactRules).toMatch(/\.ai-composer-persona-trigger[^}]*width: 2rem;/su);
    expect(compactRules).toMatch(/\.ai-model-selector-trigger[^}]*width: 2\.25rem;/su);
    expect(compactRules).toMatch(/\.ai-composer-submit[^}]*width: 1\.75rem;/su);

    const controls = (1.5 + 2.75 + 1.5 + 1.5 + 1.5 + 2 + 2.25 + 1.5 + 1.75) * 16;
    const gaps = 8 * 2;
    const approvalInset = 0.375 * 16;
    expect(controls + gaps + approvalInset).toBe(282);
    expect(controls + gaps + approvalInset - 270).toBe(12);
  });
});
