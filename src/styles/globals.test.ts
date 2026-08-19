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
