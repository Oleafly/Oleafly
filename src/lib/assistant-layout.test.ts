import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assistantMinimumWidth,
  sidebarPanelGroupWidth,
  sidebarMinimumPercent,
} from "./assistant-layout";

const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const overlaySource = readFileSync(
  new URL("../components/ai/CopilotOverlay.tsx", import.meta.url),
  "utf8",
);

describe("assistant layout minimums", () => {
  it("keeps the docked assistant wide enough for the one-line footer", () => {
    expect(sidebarMinimumPercent(840, true, 16)).toBeCloseTo((480 / 840) * 100);
    expect(sidebarMinimumPercent(1000, true, 20)).toBeCloseTo((600 / 1000) * 100);
    expect(sidebarMinimumPercent(825, false, 20)).toBeCloseTo((250 / 825) * 100);
  });

  it("subtracts the rem-sized rail and resize handle at the active app font size", () => {
    expect(sidebarPanelGroupWidth(900, 16)).toBe(840);
    expect(sidebarPanelGroupWidth(900, 20)).toBe(825);
  });

  it("scales the assistant floor with the supported app font size", () => {
    expect(assistantMinimumWidth(13)).toBe(480);
    expect(assistantMinimumWidth(16)).toBe(480);
    expect(assistantMinimumWidth(18)).toBe(540);
    expect(assistantMinimumWidth(20)).toBe(600);
  });

  it("caps a sidebar floor when the remaining workspace would become too small", () => {
    expect(sidebarMinimumPercent(400, true, 20)).toBe(65);
    expect(sidebarMinimumPercent(0, true, 20)).toBe(15);
  });

  it("applies the scaled floor to the docked assistant panel", () => {
    expect(appSource).toMatch(
      /const assistantSidebar = railTab === "ai" \|\| railTab === "chat";/u,
    );
    expect(appSource).toMatch(
      /sidebarMinimumPercent\(\s*panelGroupWidth,\s*assistantSidebar,\s*appFontSize,?\s*\)/u,
    );
    expect(appSource).toContain(
      "const panelGroupWidth = sidebarPanelGroupWidth(panelAreaWidth, appFontSize);",
    );
  });

  it("applies the scaled floor to floating assistant clamps", () => {
    expect(overlaySource).toContain(
      "const minimumWidth = assistantMinimumWidth(appFontSize);",
    );
    expect(overlaySource).toMatch(/clampRect\(next, vp, minimumWidth\)/u);
    expect(overlaySource).toContain("[floating, minimumWidth]");
  });
});
