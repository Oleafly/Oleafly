// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { appModalCoordinator, useModalLayer } from "./use-modal-accessibility";

describe("useModalLayer", () => {
  it("sits on top of the modal stack while open, so the dialog below leaves its keys alone", () => {
    const settings = appModalCoordinator.add(null);
    try {
      const { rerender, unmount } = renderHook(({ open }) => useModalLayer(open), {
        initialProps: { open: true },
      });
      expect(appModalCoordinator.isTop(settings)).toBe(false);

      rerender({ open: false });
      expect(appModalCoordinator.isTop(settings)).toBe(true);
      unmount();
    } finally {
      appModalCoordinator.remove(settings);
    }
  });

  it("says whether another modal covers it, and never while it is closed", () => {
    const { result, rerender, unmount } = renderHook(({ open }) => useModalLayer(open), {
      initialProps: { open: true },
    });
    expect(result.current()).toBe(false);
    const confirm = appModalCoordinator.add(null);
    expect(result.current()).toBe(true);
    appModalCoordinator.remove(confirm);
    expect(result.current()).toBe(false);

    rerender({ open: false });
    const other = appModalCoordinator.add(null);
    expect(result.current()).toBe(false);
    appModalCoordinator.remove(other);
    unmount();
  });

  it("puts focus back on the opener only when asked to", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    try {
      opener.focus();
      const restoring = renderHook(({ open }) => useModalLayer(open, true), { initialProps: { open: true } });
      opener.blur();
      restoring.rerender({ open: false });
      expect(opener).toHaveFocus();

      opener.focus();
      const leaving = renderHook(({ open }) => useModalLayer(open), { initialProps: { open: true } });
      opener.blur();
      leaving.rerender({ open: false });
      expect(opener).not.toHaveFocus();
      restoring.unmount();
      leaving.unmount();
    } finally {
      opener.remove();
    }
  });
});
