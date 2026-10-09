// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  APP_FONT_SIZE_STORAGE_KEY,
  APP_FONT_STORAGE_KEY,
  StoredAppTypography,
  applyAppTypography,
  storedAppTypography,
} from "./app-typography";

const root = document.documentElement;

afterEach(() => {
  localStorage.clear();
  root.style.removeProperty("font-size");
  root.style.removeProperty("--app-font");
});

describe("app typography", () => {
  it("sets the root size and the app font, and drops a blank font", () => {
    applyAppTypography("  Iowan   Old Style ", 18);
    expect(root.style.fontSize).toBe("18px");
    expect(root.style.getPropertyValue("--app-font")).toBe('"Iowan Old Style"');

    applyAppTypography("   ", 16);
    expect(root.style.getPropertyValue("--app-font")).toBe("");
  });

  it("reads the stored choice the way the settings store saves it", () => {
    expect(storedAppTypography()).toEqual({ fontFamily: "", fontSize: 16 });
    localStorage.setItem(APP_FONT_STORAGE_KEY, '"Helvetica Neue", Helvetica, sans-serif');
    localStorage.setItem(APP_FONT_SIZE_STORAGE_KEY, "14");
    expect(storedAppTypography()).toEqual({ fontFamily: "Helvetica Neue", fontSize: 14 });
    localStorage.setItem(APP_FONT_SIZE_STORAGE_KEY, "big");
    expect(storedAppTypography().fontSize).toBe(16);
  });

  it("applies the stored choice in a secondary window and follows changes from the main one", () => {
    localStorage.setItem(APP_FONT_STORAGE_KEY, "Charter");
    const view = render(<StoredAppTypography />);
    expect(root.style.getPropertyValue("--app-font")).toBe('"Charter"');

    localStorage.setItem(APP_FONT_STORAGE_KEY, "Optima");
    localStorage.setItem(APP_FONT_SIZE_STORAGE_KEY, "20");
    window.dispatchEvent(new StorageEvent("storage", { key: "oleafly.other" }));
    expect(root.style.getPropertyValue("--app-font")).toBe('"Charter"');
    window.dispatchEvent(new StorageEvent("storage", { key: APP_FONT_SIZE_STORAGE_KEY }));
    expect(root.style.getPropertyValue("--app-font")).toBe('"Optima"');
    expect(root.style.fontSize).toBe("20px");

    view.unmount();
    localStorage.setItem(APP_FONT_STORAGE_KEY, "Futura");
    window.dispatchEvent(new StorageEvent("storage", { key: APP_FONT_STORAGE_KEY }));
    expect(root.style.getPropertyValue("--app-font")).toBe('"Optima"');
  });
});
