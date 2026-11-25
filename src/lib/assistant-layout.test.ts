import { describe, expect, it } from "vitest";
import {
  assistantMinimumWidth,
  fileSidebarWidth,
  sidebarPanelGroupWidth,
  sidebarMinimumPercent,
} from "./assistant-layout";

describe("assistant layout minimums", () => {
  it("keeps the docked assistant wide enough for the one-line footer", () => {
    expect(sidebarMinimumPercent(840, true, 16)).toBeCloseTo((480 / 840) * 100);
    expect(sidebarMinimumPercent(1000, true, 20)).toBeCloseTo((600 / 1000) * 100);
    expect(sidebarMinimumPercent(825, false, 20)).toBeCloseTo((fileSidebarWidth(20) / 825) * 100);
  });

  it("fits seven rail buttons in the file sidebar at every app font size", () => {
    expect(fileSidebarWidth(16)).toBe(266);
    expect(fileSidebarWidth(20)).toBe(330);
    expect(fileSidebarWidth(Number.NaN)).toBe(266);
  });

  it("subtracts the resize handle at the active app font size", () => {
    expect(sidebarPanelGroupWidth(900, 16)).toBe(888);
    expect(sidebarPanelGroupWidth(900, 20)).toBe(885);
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
});
