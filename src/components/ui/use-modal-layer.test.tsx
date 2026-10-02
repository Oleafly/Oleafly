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
});
