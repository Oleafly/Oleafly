// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { APP_ICONS, useSettingsStore } from "@/store/settings";
import { LeafLogo } from "./LeafLogo";

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.getState().resetAppearancePreferences();
});

function quill(container: HTMLElement) {
  const path = container.querySelector("path");
  if (!path) throw new Error("the logo has no quill");
  return path;
}

describe("LeafLogo", () => {
  it("draws the classic green quill by default", () => {
    const { container } = render(<LeafLogo />);
    expect(quill(container)).toHaveAttribute("fill", "#34B44A");
    expect(container.querySelector("linearGradient")).toBeNull();
  });

  it("draws the quill in the chosen icon's gradient", () => {
    act(() => useSettingsStore.getState().setAppIcon("pastel"));
    const { container } = render(<LeafLogo />);
    const gradient = container.querySelector("linearGradient");
    expect(gradient).not.toBeNull();
    expect(quill(container)).toHaveAttribute("fill", `url(#${gradient?.id})`);
    expect(
      [...container.querySelectorAll("stop")].map((stop) => [
        stop.getAttribute("offset"),
        stop.getAttribute("stop-color"),
      ]),
    ).toEqual([
      ["0", "#67E8F9"],
      ["0.3333333333333333", "#A78BFA"],
      ["0.6666666666666666", "#F472B6"],
      ["1", "#FBBF24"],
    ]);
  });

  it("keeps a visible blue quill for the blue tile icon", () => {
    act(() => useSettingsStore.getState().setAppIcon("blue"));
    const { container } = render(<LeafLogo />);
    expect(quill(container)).toHaveAttribute("fill", "#2F6FDB");
  });

  it("follows a change of icon while it is on screen", () => {
    const { container } = render(<LeafLogo />);
    act(() => useSettingsStore.getState().setAppIcon("ocean"));
    expect(container.querySelectorAll("stop")).toHaveLength(3);
    act(() => useSettingsStore.getState().setAppIcon("classic"));
    expect(quill(container)).toHaveAttribute("fill", "#34B44A");
  });

  it("gives two logos on one screen their own gradient", () => {
    act(() => useSettingsStore.getState().setAppIcon("sunset"));
    const { container } = render(
      <>
        <LeafLogo />
        <LeafLogo />
      </>,
    );
    const ids = [...container.querySelectorAll("linearGradient")].map((gradient) => gradient.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("has a quill colour for every icon", () => {
    for (const icon of APP_ICONS) {
      expect(icon.quill.length, icon.id).toBeGreaterThan(0);
      for (const colour of icon.quill) expect(colour, icon.id).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});
