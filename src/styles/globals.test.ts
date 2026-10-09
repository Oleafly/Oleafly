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
    const modelBreakpoint = styles.indexOf(
      "@container ai-composer (max-width: 28rem)",
    );

    expect(personaBreakpoint).toBeGreaterThan(-1);
    expect(promptsBreakpoint).toBeGreaterThan(personaBreakpoint);
    expect(modelBreakpoint).toBeGreaterThan(promptsBreakpoint);
    const personaRules = styles.slice(personaBreakpoint, promptsBreakpoint);
    const promptsRules = styles.slice(promptsBreakpoint, modelBreakpoint);

    expect(personaRules).toMatch(/\.ai-composer-persona-value\s*\{\s*display: none;/u);
    expect(personaRules).toMatch(/\.ai-composer-persona-trigger\s*\{[^}]*width: 2\.5rem;/su);
    expect(promptsRules).toMatch(/\.ai-composer-prompts-value\s*\{\s*display: none;/u);
    expect(promptsRules).toMatch(/\.ai-composer-prompts-icon\s*\{\s*display: block;/u);
    expect(promptsRules).toMatch(/\.ai-composer-prompts-trigger\s*\{[^}]*width: 2\.5rem;/su);
    expect(styles.match(/\.ai-composer-persona-value\s*\{[^}]*display:\s*none;/gsu)).toHaveLength(1);
    expect(styles.match(/\.ai-composer-prompts-value\s*\{[^}]*display:\s*none;/gsu)).toHaveLength(1);
    expect(styles).not.toMatch(/\.ai-composer-approval-value\s*\{[^}]*display:\s*none;/su);
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

describe("resizable panels", () => {
  it("drops the percentage max-height react-resizable-panels sets inline", () => {
    expect(styles).toMatch(
      /\[data-panel\],\s*\[data-panel\] > div\s*\{\s*max-height: none !important;\s*\}/u,
    );
  });
});

describe("app font", () => {
  it("leads every interface font stack with the chosen app font", () => {
    const stacks = [...styles.matchAll(/--font-sans:\s*([^;]+);/gu)].map(([, stack]) => stack);
    expect(stacks).toHaveLength(5);
    for (const stack of stacks) expect(stack.startsWith('var(--app-font, "Geist"), ')).toBe(true);
  });
});

describe("Zen mode editor width", () => {
  it("never narrows the editor to a centered column", () => {
    expect(styles).not.toMatch(/\[data-zen[^\]]*\][^{]*\.cm-(scroller|content)[^{]*\{[^}]*(padding-inline|max-width)/u);
  });
});

describe("text selection policy", () => {
  const unlayered = (() => {
    let depth = 0;
    let layerDepth = -1;
    let out = "";
    for (let index = 0; index < styles.length; index += 1) {
      const char = styles[index];
      if (char === "{") {
        if (layerDepth < 0 && /@layer[^;{]*$/u.test(styles.slice(Math.max(0, index - 80), index))) {
          layerDepth = depth;
        }
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === layerDepth) {
          layerDepth = -1;
          continue;
        }
      }
      if (layerDepth < 0) out += char;
    }
    return out;
  })();

  const block = (selector: RegExp) => selector.exec(unlayered)?.[1] ?? "";

  it("makes interface text unselectable by default", () => {
    const rule = block(/(?:^|\n)html,\s*body\s*\{([^}]*)\}/u);
    expect(rule).toMatch(/-webkit-user-select:\s*none;/u);
    expect(rule).toMatch(/(?:^|[^-])user-select:\s*none;/u);
  });

  it("keeps every editable surface selectable", () => {
    const rule = block(
      /input,\s*textarea,\s*\[contenteditable\]:not\(\[contenteditable="false"\]\),\s*\.cm-editor \.cm-content\s*\{([^}]*)\}/u,
    );
    expect(rule).toMatch(/-webkit-user-select:\s*text;/u);
    expect(rule).toMatch(/(?:^|[^-])user-select:\s*text;/u);
  });

  it("writes the WebKit prefix next to every user-select declaration", () => {
    const plain = styles.match(/(?:^|[^-])user-select:\s*[a-z]+/gu) ?? [];
    const prefixed = styles.match(/-webkit-user-select:\s*[a-z]+/gu) ?? [];
    expect(plain.length).toBeGreaterThan(0);
    expect(prefixed).toHaveLength(plain.length);
  });

  it("shows the arrow over interface text and the I-beam only where text can be selected", () => {
    expect(styles).toMatch(/body\s*\{[^}]*cursor:\s*default;/u);
    expect(styles).toMatch(
      /\.select-text,\s*\.select-all,\s*\.cm-editor \.cm-content\[contenteditable="false"\]\s*\{\s*cursor:\s*auto;\s*\}/u,
    );
  });

  it("uses no outline, ring or shadow ring in the selection rules", () => {
    expect(block(/(?:^|\n)html,\s*body\s*\{([^}]*)\}/u)).not.toMatch(/outline|ring|box-shadow/u);
  });
});
