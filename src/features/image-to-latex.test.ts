// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";

const mocks = vi.hoisted(() => ({
  completeViaBackend: vi.fn(),
  insertAtCursor: vi.fn(),
  logError: vi.fn(),
  writeText: vi.fn(),
  files: { projectId: "paper" as string | null, activePath: "main.tex" as string | null },
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    infoUnique: vi.fn(() => 11),
    errorUnique: vi.fn(() => 11),
    dismiss: vi.fn(),
  },
}));

vi.mock("@/lib/agent-backend", () => ({ completeViaBackend: mocks.completeViaBackend }));
vi.mock("@/components/editor/cm/controller", () => ({ insertAtCursor: mocks.insertAtCursor }));
vi.mock("@/lib/ai-figure", () => ({ modelSupportsVision: vi.fn(() => true) }));
vi.mock("@/lib/ai-providers", () => ({ hasConfiguredProvider: vi.fn(() => true), pickActiveProvider: vi.fn() }));
vi.mock("@/lib/tauri", () => ({ getConfig: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/toast", () => ({ toast: mocks.toast }));
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => mocks.files } }));

import { imageToLatex } from "./image-to-latex";

const KEY = "image-to-latex";
const image = () => new File([new Uint8Array([1, 2, 3])], "equation.png", { type: "image/png" });

function failure(detail: string): string {
  return i18n.t(($) => $.core.imageToLatex.failed, { detail });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.files.projectId = "paper";
  mocks.files.activePath = "main.tex";
  mocks.completeViaBackend.mockResolvedValue({ text: "```latex\n\\begin{equation}E=mc^2\\end{equation}\n```" });
  mocks.writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: mocks.writeText } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("imageToLatex", () => {
  it("shows one progress slot and lets the inserted snippet confirm the result", async () => {
    await imageToLatex(image());

    expect(mocks.toast.infoUnique).toHaveBeenCalledExactlyOnceWith(
      KEY,
      i18n.t(($) => $.core.imageToLatex.transcribing),
      undefined,
      true,
    );
    expect(mocks.insertAtCursor).toHaveBeenCalledExactlyOnceWith("\\begin{equation}E=mc^2\\end{equation}");
    expect(mocks.toast.dismiss).toHaveBeenCalledExactlyOnceWith(11);
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(mocks.toast.info).not.toHaveBeenCalled();
    expect(mocks.toast.errorUnique).not.toHaveBeenCalled();
  });

  it("turns the progress slot into a catalog failure when the model returns nothing", async () => {
    mocks.completeViaBackend.mockResolvedValue({ text: "```\n```" });

    await imageToLatex(image());

    expect(mocks.insertAtCursor).not.toHaveBeenCalled();
    expect(mocks.toast.errorUnique).toHaveBeenCalledExactlyOnceWith(
      KEY,
      failure(i18n.t(($) => $.ai.conversation.noOutput)),
    );
    expect(mocks.toast.error).not.toHaveBeenCalled();
    expect(mocks.logError).toHaveBeenCalledWith("image-to-latex", expect.any(Error));
  });

  it("describes a backend error without the raw error prefix", async () => {
    mocks.completeViaBackend.mockRejectedValue(new Error("provider unavailable"));

    await imageToLatex(image());

    expect(mocks.toast.errorUnique).toHaveBeenCalledExactlyOnceWith(KEY, failure("provider unavailable"));
  });

  it("translates a structured backend error", async () => {
    mocks.completeViaBackend.mockRejectedValue('@oleafly/error:{"code":"project.name_empty","params":{}}');

    await imageToLatex(image());

    expect(mocks.toast.errorUnique).toHaveBeenCalledExactlyOnceWith(
      KEY,
      failure("Project name cannot be empty."),
    );
  });

  it("reports an unreadable image through the same slot instead of an unhandled rejection", async () => {
    class BrokenReader {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      result: string | null = null;
      readAsDataURL() {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal("FileReader", BrokenReader);

    await expect(imageToLatex(image())).resolves.toBeUndefined();

    expect(mocks.completeViaBackend).not.toHaveBeenCalled();
    expect(mocks.toast.errorUnique).toHaveBeenCalledExactlyOnceWith(
      KEY,
      failure(i18n.t(($) => $.ai.acp.imageReadFailed)),
    );
  });

  it.each([
    ["the active file changed", () => { mocks.files.activePath = "chapter.tex"; }],
    ["the project closed", () => { mocks.files.projectId = null; mocks.files.activePath = null; }],
  ])("copies the snippet instead of inserting it when %s", async (_label, change) => {
    mocks.completeViaBackend.mockImplementation(async () => {
      change();
      return { text: "x^2" };
    });

    await imageToLatex(image());

    expect(mocks.insertAtCursor).not.toHaveBeenCalled();
    expect(mocks.writeText).toHaveBeenCalledExactlyOnceWith("x^2");
    expect(mocks.toast.infoUnique).toHaveBeenLastCalledWith(KEY, i18n.t(($) => $.library.pdfImport.copied));
    expect(mocks.toast.infoUnique).toHaveBeenCalledTimes(2);
    expect(mocks.toast.dismiss).not.toHaveBeenCalled();
  });

  it("keeps a newer transcription's progress visible when an older one finishes first", async () => {
    let finishFirst!: (value: { text: string }) => void;
    mocks.completeViaBackend
      .mockReturnValueOnce(new Promise((resolve) => { finishFirst = resolve; }))
      .mockReturnValueOnce(new Promise(() => {}));

    const first = imageToLatex(image());
    await vi.waitFor(() => expect(mocks.completeViaBackend).toHaveBeenCalledTimes(1));
    void imageToLatex(image());
    await vi.waitFor(() => expect(mocks.completeViaBackend).toHaveBeenCalledTimes(2));
    finishFirst({ text: "a+b" });
    await first;

    expect(mocks.insertAtCursor).toHaveBeenCalledWith("a+b");
    expect(mocks.toast.dismiss).not.toHaveBeenCalled();
  });
});
