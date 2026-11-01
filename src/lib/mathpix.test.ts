import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const channels: Array<{ onmessage: (message: unknown) => void }> = [];
  class FakeChannel {
    onmessage: (message: unknown) => void = () => {};
    constructor() {
      channels.push(this);
    }
  }
  return { invoke: vi.fn(), channels, FakeChannel };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, Channel: mocks.FakeChannel }));

import { mathpixClearKeys, mathpixKeyStatus, mathpixPdf, mathpixSaveKeys, mathpixText } from "./mathpix";

const CANCELLED = '@oleafly/error:{"code":"mathpix.cancelled","params":{}}';

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.channels.length = 0;
});

describe("Mathpix bridge", () => {
  it("calls the key commands and never asks for the key back", async () => {
    mocks.invoke.mockImplementation(async (command: string) =>
      command === "mathpix_clear_keys" ? undefined : { configured: true, appId: "APP" },
    );
    await expect(mathpixKeyStatus()).resolves.toEqual({ configured: true, appId: "APP" });
    await mathpixSaveKeys("APP", "KEY");
    await mathpixClearKeys();
    await mathpixText("iVBORw0KGgo=", "image/png");
    expect(mocks.invoke.mock.calls).toEqual([
      ["mathpix_key_status"],
      ["mathpix_save_keys", { appId: "APP", appKey: "KEY" }],
      ["mathpix_clear_keys"],
      ["mathpix_text", { imageBase64: "iVBORw0KGgo=", mime: "image/png" }],
    ]);
    const commands = mocks.invoke.mock.calls.map(([command]) => command);
    expect(commands).not.toContain("get_connector_key");
  });

  it("uploads the PDF as a raw body with the page range header", async () => {
    mocks.invoke.mockImplementation(async (command: string) =>
      command === "mathpix_pdf_upload" ? "pdf-1" : "P1",
    );
    const bytes = new Uint8Array([37, 80, 68, 70]);
    await expect(mathpixPdf(bytes, { pageRanges: "3-5" })).resolves.toBe("P1");
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "mathpix_pdf_upload", bytes, {
      headers: { "x-oleafly-page-ranges": "3-5", "x-oleafly-request-id": expect.any(String) },
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "mathpix_pdf_wait", {
      requestId: expect.any(String),
      pdfId: "pdf-1",
      onProgress: mocks.channels[0],
    });
    const uploadHeaders = (mocks.invoke.mock.calls[0][2] as { headers: Record<string, string> }).headers;
    const waitArgs = mocks.invoke.mock.calls[1][1] as { requestId: string };
    expect(uploadHeaders["x-oleafly-request-id"]).toBe(waitArgs.requestId);
  });

  it("forwards progress and returns the Markdown", async () => {
    const progress = vi.fn();
    mocks.invoke.mockImplementation(async (command: string, args?: { onProgress?: { onmessage: (m: unknown) => void } }) => {
      if (command === "mathpix_pdf_upload") return "pdf-2";
      args?.onProgress?.onmessage({ status: "split", pagesDone: 1, pagesTotal: 3 });
      args?.onProgress?.onmessage({ status: "completed", pagesDone: 3, pagesTotal: 3 });
      return "P1\n\\pagebreak\nP2";
    });
    await expect(mathpixPdf(new Uint8Array([1]), { pageRanges: "1-3", onProgress: progress })).resolves.toBe(
      "P1\n\\pagebreak\nP2",
    );
    expect(progress.mock.calls).toEqual([
      [{ status: "split", pagesDone: 1, pagesTotal: 3 }],
      [{ status: "completed", pagesDone: 3, pagesTotal: 3 }],
    ]);
    mocks.channels[0].onmessage({ status: "late", pagesDone: 9, pagesTotal: 9 });
    expect(progress).toHaveBeenCalledTimes(2);
  });

  it("cancels upstream and rejects with AbortError when the signal aborts", async () => {
    const controller = new AbortController();
    let rejectWait!: (reason: unknown) => void;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "mathpix_pdf_upload") return Promise.resolve("pdf-3");
      if (command === "mathpix_pdf_wait") {
        return new Promise((_resolve, reject) => {
          rejectWait = reject;
        });
      }
      if (command === "mathpix_pdf_cancel") {
        rejectWait(CANCELLED);
        return Promise.resolve();
      }
      return Promise.resolve();
    });
    const running = mathpixPdf(new Uint8Array([1]), { pageRanges: "1-2", signal: controller.signal });
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("mathpix_pdf_wait", expect.any(Object)));
    const waitArgs = mocks.invoke.mock.calls.find(([command]) => command === "mathpix_pdf_wait")?.[1] as {
      requestId: string;
    };
    controller.abort();
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.invoke).toHaveBeenCalledWith("mathpix_pdf_cancel", { requestId: waitArgs.requestId });
  });

  it("stops the upload itself when the user cancels while it runs", async () => {
    const controller = new AbortController();
    let failUpload!: (reason: unknown) => void;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "mathpix_pdf_upload") {
        return new Promise((_resolve, reject) => {
          failUpload = reject;
        });
      }
      if (command === "mathpix_pdf_cancel") {
        failUpload(CANCELLED);
        return Promise.resolve();
      }
      return Promise.resolve();
    });
    const running = mathpixPdf(new Uint8Array([1]), { pageRanges: "1-9", signal: controller.signal });
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("mathpix_pdf_upload", expect.anything(), expect.anything()));
    const uploadHeaders = (mocks.invoke.mock.calls[0][2] as { headers: Record<string, string> }).headers;
    controller.abort();
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.invoke).toHaveBeenCalledWith("mathpix_pdf_cancel", {
      requestId: uploadHeaders["x-oleafly-request-id"],
    });
    const commands = mocks.invoke.mock.calls.map(([command]) => command);
    expect(commands).toEqual(["mathpix_pdf_upload", "mathpix_pdf_cancel"]);
  });

  it("deletes an upload that finished after the user stopped", async () => {
    const controller = new AbortController();
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "mathpix_pdf_upload") {
        controller.abort();
        return "pdf-4";
      }
      if (command === "mathpix_pdf_wait") throw CANCELLED;
      return undefined;
    });
    await expect(
      mathpixPdf(new Uint8Array([1]), { pageRanges: "1", signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    const commands = mocks.invoke.mock.calls.map(([command]) => command);
    expect(commands).toEqual(["mathpix_pdf_upload", "mathpix_pdf_cancel", "mathpix_pdf_wait"]);
  });

  it("refuses a PDF over 256 MB before sending any of it", async () => {
    const huge = { byteLength: 256 * 1024 * 1024 + 1 } as unknown as Uint8Array;
    await expect(mathpixPdf(huge, { pageRanges: "1" })).rejects.toMatchObject({
      name: "AppError",
      code: "mathpix.pdf_too_large",
    });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("cancels an image read by its request id when the signal aborts", async () => {
    const controller = new AbortController();
    let failRead!: (reason: unknown) => void;
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "mathpix_text") {
        return new Promise((_resolve, reject) => {
          failRead = reject;
        });
      }
      if (command === "mathpix_text_cancel") {
        failRead(CANCELLED);
        return Promise.resolve();
      }
      return Promise.resolve();
    });
    const running = mathpixText("iVBORw0KGgo=", "image/png", { signal: controller.signal });
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("mathpix_text", expect.anything()));
    const args = mocks.invoke.mock.calls[0][1] as { requestId: string };
    expect(args).toEqual({ imageBase64: "iVBORw0KGgo=", mime: "image/png", requestId: expect.any(String) });
    controller.abort();
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.invoke).toHaveBeenCalledWith("mathpix_text_cancel", { requestId: args.requestId });
  });

  it("does not read an image when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(mathpixText("iVBORw0KGgo=", "image/png", { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("does not upload when the signal is already aborted, and passes other errors through", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      mathpixPdf(new Uint8Array([1]), { pageRanges: "1", signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.invoke).not.toHaveBeenCalled();

    const failure = '@oleafly/error:{"code":"mathpix.key_rejected","params":{}}';
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "mathpix_pdf_upload") return "pdf-5";
      throw failure;
    });
    await expect(mathpixPdf(new Uint8Array([1]), { pageRanges: "1" })).rejects.toBe(failure);
  });
});
