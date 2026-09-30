// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { useSettingsStore } from "@/store/settings";
import { ChangedSettingsProvider } from "./changed-settings";
import { SettingsToggleRow } from "./SettingsToggleRow";

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({
    preference: "system",
    theme: "dark",
    setPreference: vi.fn(),
    toggleTheme: vi.fn(),
  }),
}));

const LABEL = "Feature";
const DESCRIPTION = "A useful setting.";

describe("SettingsToggleRow", () => {
  it("supports pointer and keyboard toggles in both states", () => {
    const onChange = vi.fn();
    const view = render(
      <SettingsToggleRow label={LABEL} checked={false} onChange={onChange} />,
    );
    const toggle = screen.getByRole("switch", { name: LABEL });

    fireEvent.click(toggle);
    fireEvent.keyDown(toggle, { key: "Enter" });
    fireEvent.keyDown(toggle, { key: " " });
    fireEvent.keyDown(toggle, { key: "ArrowRight" });
    expect(onChange.mock.calls).toEqual([[true], [true], [true]]);

    view.rerender(
      <SettingsToggleRow
        label={LABEL}
        description={DESCRIPTION}
        checked
        onChange={onChange}
      />,
    );
    expect(screen.getByText(DESCRIPTION)).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("announces the changed state on the switch and offers a Reset only while it differs", () => {
    const label = enSettings.appearance.editor.mathPreview.label;
    const reset = enSettings.changed.reset.replace("{{label}}", label);
    const onChange = vi.fn();
    useSettingsStore.getState().setEditorMathPreview(true);
    renderMathPreviewRow(onChange);
    const toggle = screen.getByRole("switch", { name: label });
    expect(toggle).not.toHaveAccessibleDescription();
    expect(screen.queryByRole("button", { name: reset })).not.toBeInTheDocument();

    act(() => useSettingsStore.getState().setEditorMathPreview(false));
    expect(toggle.parentElement).toHaveAttribute("data-setting-id", "editorMathPreview");
    expect(toggle).toHaveAccessibleName(label);
    expect(toggle).toHaveAccessibleDescription(enSettings.changed.marker);

    fireEvent.click(screen.getByRole("button", { name: reset }));

    expect(useSettingsStore.getState().editorMathPreview).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: reset })).not.toBeInTheDocument();
    expect(toggle).not.toHaveAccessibleDescription();
  });

  it("keeps the switch indicator in place when the Reset button appears", () => {
    const label = enSettings.appearance.editor.mathPreview.label;
    useSettingsStore.getState().setEditorMathPreview(true);
    renderMathPreviewRow();
    const toggle = screen.getByRole("switch", { name: label });
    const trailing = toggle.lastElementChild;

    act(() => useSettingsStore.getState().setEditorMathPreview(false));

    // The slot and indicator are the same nodes, and Reset overlays the slot
    // from outside the switch.
    expect(toggle.lastElementChild).toBe(trailing);
    expect(trailing?.childElementCount).toBe(2);
    const reset = screen.getByRole("button", {
      name: enSettings.changed.reset.replace("{{label}}", label),
    });
    expect(toggle).not.toContainElement(reset);
  });

  it("lets only the Reset button take the pointer in the overlay", () => {
    const label = enSettings.appearance.editor.mathPreview.label;
    useSettingsStore.getState().setEditorMathPreview(false);
    renderMathPreviewRow();
    const reset = screen.getByRole("button", {
      name: enSettings.changed.reset.replace("{{label}}", label),
    });
    const row = reset.closest<HTMLElement>("[data-setting-id]");
    if (!row) throw new Error("math preview row is missing");

    // The overlay spans the row's height. Clicks above and below the button
    // go through it to the switch.
    const overlay = [...row.children].find((child) => child.contains(reset));
    expect(overlay).toHaveClass("pointer-events-none");
    expect(reset).toHaveClass("pointer-events-auto");
  });

  it("moves keyboard focus back to the switch after a reset", async () => {
    const label = enSettings.appearance.editor.mathPreview.label;
    useSettingsStore.getState().setEditorMathPreview(false);
    renderMathPreviewRow();
    const reset = screen.getByRole("button", {
      name: enSettings.changed.reset.replace("{{label}}", label),
    });

    reset.focus();
    fireEvent.click(reset);

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("switch", { name: label })),
    );
  });
});

function renderMathPreviewRow(onChange = vi.fn()) {
  const label = enSettings.appearance.editor.mathPreview.label;
  function Row() {
    const checked = useSettingsStore((state) => state.editorMathPreview);
    return (
      <SettingsToggleRow
        settingId="editorMathPreview"
        label={label}
        checked={checked}
        onChange={onChange}
      />
    );
  }
  return render(
    <ChangedSettingsProvider>
      <Row />
    </ChangedSettingsProvider>,
  );
}
