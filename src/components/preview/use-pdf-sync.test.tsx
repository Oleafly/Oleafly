// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pdfSyncStatus: vi.fn(),
  pdfSyncSet: vi.fn(),
  notifyError: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  pdfSyncStatus: mocks.pdfSyncStatus,
  pdfSyncSet: mocks.pdfSyncSet,
}));
vi.mock("@/lib/toast", () => ({ notifyError: mocks.notifyError }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import enPreview from "@/i18n/locales/en/preview.json" with { type: "json" };
import { usePdfSync } from "./use-pdf-sync";

const off = { enabled: false, path: null, failed: null, localOnly: false };
const on = { enabled: true, path: "Thesis.pdf", failed: null, localOnly: false };

function setup(overrides: Partial<Parameters<typeof usePdfSync>[0]> = {}) {
  return renderHook((props: Parameters<typeof usePdfSync>[0]) => usePdfSync(props), {
    initialProps: {
      projectId: "alpha",
      available: true,
      outputId: "pdf-v1:1:aa",
      fastCompile: false,
      ...overrides,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pdfSyncStatus.mockResolvedValue(off);
  mocks.pdfSyncSet.mockResolvedValue(on);
});

describe("usePdfSync", () => {
  it("offers nothing when sync can't run here", () => {
    expect(setup({ available: false }).result.current).toBeNull();
    expect(setup({ projectId: null }).result.current).toBeNull();
    expect(mocks.pdfSyncStatus).not.toHaveBeenCalled();
  });

  it("reads the saved setting for the open project", async () => {
    mocks.pdfSyncStatus.mockResolvedValue(on);
    const { result } = setup();
    await waitFor(() => expect(result.current?.enabled).toBe(true));
    expect(result.current?.path).toBe("Thesis.pdf");
    expect(result.current?.note).toBeNull();
  });

  it("copies the current preview when turned on and sends no preview when turned off", async () => {
    const { result } = setup();
    await waitFor(() => expect(mocks.pdfSyncStatus).toHaveBeenCalled());

    act(() => result.current?.setEnabled(true));
    await waitFor(() => expect(result.current?.enabled).toBe(true));
    expect(mocks.pdfSyncSet).toHaveBeenLastCalledWith("alpha", true, "pdf-v1:1:aa");

    mocks.pdfSyncSet.mockResolvedValue(off);
    act(() => result.current?.setEnabled(false));
    await waitFor(() => expect(result.current?.enabled).toBe(false));
    expect(mocks.pdfSyncSet).toHaveBeenLastCalledWith("alpha", false, null);
  });

  it("shows no toast for a background failure and names the file instead", async () => {
    mocks.pdfSyncStatus.mockResolvedValue({ ...on, failed: "Thesis.pdf" });
    const { result } = setup();
    await waitFor(() =>
      expect(result.current?.note).toBe(
        enPreview.sync.failed.replace("{{name}}", "Thesis.pdf"),
      ),
    );
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("warns when fast compiles keep the PDF from updating", async () => {
    mocks.pdfSyncStatus.mockResolvedValue(on);
    const { result } = setup({ fastCompile: true });
    await waitFor(() => expect(result.current?.note).toBe(enPreview.sync.fastMode));
  });

  it("says a shared project's copy stays on this computer", async () => {
    mocks.pdfSyncStatus.mockResolvedValue({ ...on, localOnly: true });
    const { result } = setup();
    await waitFor(() => expect(result.current?.note).toBe(enPreview.sync.localOnly));
  });

  it("ignores a late answer for the project that was left", async () => {
    let finish: (value: typeof on) => void = () => {};
    mocks.pdfSyncStatus.mockImplementationOnce(
      () => new Promise((resolve) => { finish = resolve; }),
    );
    const { result, rerender } = setup();
    mocks.pdfSyncStatus.mockResolvedValue(off);
    rerender({ projectId: "beta", available: true, outputId: null, fastCompile: false });
    await waitFor(() => expect(mocks.pdfSyncStatus).toHaveBeenLastCalledWith("beta"));
    await act(async () => {
      finish(on);
      await Promise.resolve();
    });
    expect(result.current?.enabled).toBe(false);
  });

  it("reports a refused change once, because the user asked for it", async () => {
    const refused = new Error("nope");
    mocks.pdfSyncSet.mockRejectedValue(refused);
    const { result } = setup();
    await waitFor(() => expect(mocks.pdfSyncStatus).toHaveBeenCalled());
    act(() => result.current?.setEnabled(true));
    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalledOnce());
    expect(mocks.notifyError.mock.calls[0][1]).toBe(refused);
    expect(result.current?.busy).toBe(false);
  });
});
