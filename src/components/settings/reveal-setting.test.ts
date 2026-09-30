// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  revealSettingRow,
  settingIdFromScrollTarget,
  settingScrollTarget,
} from "./reveal-setting";

function renderRow() {
  const container = document.createElement("div");
  container.innerHTML = `
    <div data-setting-id="editorTabSize">
      <span>Tab size</span>
      <button type="button" data-setting-reset>Reset</button>
      <button type="button" disabled>Disabled</button>
      <button type="button" data-testid="control">4</button>
    </div>`;
  document.body.append(container);
  const row = container.querySelector<HTMLElement>("[data-setting-id]");
  if (!row) throw new Error("row is missing");
  const scrollIntoView = vi.fn();
  row.scrollIntoView = scrollIntoView;
  return { container, row, scrollIntoView };
}

describe("reveal setting", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("round-trips a setting id through the settings scroll target", () => {
    expect(settingIdFromScrollTarget(settingScrollTarget("editorMathPreview"))).toBe(
      "editorMathPreview",
    );
    expect(settingIdFromScrollTarget(settingScrollTarget("shortcut.recompile"))).toBe(
      "shortcut.recompile",
    );
    expect(settingIdFromScrollTarget("templates")).toBeNull();
    expect(settingIdFromScrollTarget(null)).toBeNull();
  });

  it("scrolls to the row, tints it for a moment and focuses its control", () => {
    vi.useFakeTimers();
    const { container, row, scrollIntoView } = renderRow();

    expect(revealSettingRow(container, "editorTabSize")).toBe(true);

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(row).toHaveAttribute("data-setting-highlight");
    expect(document.activeElement).toBe(container.querySelector('[data-testid="control"]'));

    vi.advanceTimersByTime(2000);
    expect(row).not.toHaveAttribute("data-setting-highlight");
  });

  it("reports a row that is not rendered", () => {
    const { container } = renderRow();
    expect(revealSettingRow(container, "editorMathPreview")).toBe(false);
    expect(revealSettingRow(null, "editorTabSize")).toBe(false);
  });
});
