// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { PdfViewerHandle } from "@/components/pdf/PdfViewer";
import { usePdfPosition } from "./use-pdf-position";

beforeEach(() => localStorage.clear());

it("restores the last page after loading and keeps projects separate", () => {
  localStorage.setItem("oleafly.pdf.page.paper", "7");
  const gotoPage = vi.fn();
  const viewer = { current: { gotoPage } as unknown as PdfViewerHandle };
  const { result, rerender } = renderHook(({ projectId }) => usePdfPosition(projectId, viewer), { initialProps: { projectId: "paper" } });
  result.current.onLoad({ status: "loading", documentIdentity: "pdf" });
  result.current.onPage(1);
  result.current.onLoad({ status: "ready", documentIdentity: "pdf" });
  expect(gotoPage).toHaveBeenLastCalledWith(7);
  result.current.onPage(8);
  expect(localStorage.getItem("oleafly.pdf.page.paper")).toBe("8");
  rerender({ projectId: "other" });
  result.current.onLoad({ status: "ready", documentIdentity: "other" });
  expect(gotoPage).toHaveBeenLastCalledWith(1);
  expect(localStorage.getItem("oleafly.pdf.page.paper")).toBe("8");
});
