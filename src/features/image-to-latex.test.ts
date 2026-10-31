// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n";

const mocks = vi.hoisted(() => ({
  transcribeEditorImage: vi.fn(),
  modelInfo: vi.fn(),
  completeViaBackend: vi.fn(),
  insertAtCursor: vi.fn(),
  logError: vi.fn(),
  writeText: vi.fn(),
  files: {
    projectId: "paper" as string | null,
    activePath: "main.tex" as string | null,
    engine: { id: "latex", typst_resolved: null as { version: string } | null },
  },
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    infoUnique: vi.fn(() => 11),
    errorUnique: vi.fn(() => 11),
    dismiss: vi.fn(),
  },
}));

vi.mock("@/features/tools-ai/transcribe", () => ({
  transcribeEditorImage: mocks.transcribeEditorImage,
  modelInfo: mocks.modelInfo,
}));
vi.mock("@/lib/agent-backend", () => ({ completeViaBackend: mocks.completeViaBackend }));
vi.mock("@/components/editor/cm/controller", () => ({ insertAtCursor: mocks.insertAtCursor }));
vi.mock("@/lib/tauri", () => ({ getConfig: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/toast", () => ({ toast: mocks.toast }));
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => mocks.files } }));

import { getConfig } from "@/lib/tauri";
import { invalidateConfigCache } from "@/lib/config-cache";
import { imageToLatex, imageToLatexAvailable, imageToTypst } from "./image-to-latex";

const KEY = "image-to-latex";
const image = () => new File([new Uint8Array([1, 2, 3])], "equation.png", { type: "image/png" });

function failure(detail: string): string {
  return i18n.t(($) => $.core.imageToLatex.failed, { detail });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.files.projectId = "paper";
  mocks.files.activePath = "main.tex";
  mocks.files.engine = { id: "latex", typst_resolved: null };
  mocks.transcribeEditorImage.mockResolvedValue("\\begin{equation}E=mc^2\\end{equation}");
  mocks.modelInfo.mockReturnValue({ label: "glm-ocr", sentTo: null });
  mocks.writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: mocks.writeText } });
});

describe("imageToLatex", () => {
  it("transcribes with the Tools model instead of the assistant's provider", async () => {
    await imageToLatex(image());
    expect(mocks.transcribeEditorImage).toHaveBeenCalledWith(expect.any(File), "LaTeX", expect.any(Object));
    expect(mocks.completeViaBackend).not.toHaveBeenCalled();
  });

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

  it("says where the image goes while a hosted model works", async () => {
    const hosted = { engine: "llm", label: "Claude Opus 5.5" };
    mocks.modelInfo.mockReturnValue({ label: "Claude Opus 5.5", sentTo: "Anthropic" });
    mocks.transcribeEditorImage.mockImplementation(
      async (_file: File, _target: string, options: { onModel?: (model: unknown) => void }) => {
        options.onModel?.(hosted);
        return "x^2";
      },
    );

    await imageToLatex(image());

    expect(mocks.modelInfo).toHaveBeenCalledWith(hosted);
    expect(mocks.toast.infoUnique).toHaveBeenLastCalledWith(KEY, "Sending the image to Anthropic…", undefined, true);
    expect(mocks.insertAtCursor).toHaveBeenCalledWith("x^2");
  });

  it("keeps the first progress text for a model on this computer", async () => {
    mocks.transcribeEditorImage.mockImplementation(
      async (_file: File, _target: string, options: { onModel?: (model: unknown) => void }) => {
        options.onModel?.({ engine: "llm", label: "glm-ocr" });
        return "x";
      },
    );
    await imageToLatex(image());
    expect(mocks.toast.infoUnique).toHaveBeenCalledOnce();
  });

  it("turns the progress slot into a catalog failure when the model returns nothing", async () => {
    mocks.transcribeEditorImage.mockResolvedValue("   ");

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
    mocks.transcribeEditorImage.mockRejectedValue(new Error("provider unavailable"));

    await imageToLatex(image());

    expect(mocks.toast.errorUnique).toHaveBeenCalledExactlyOnceWith(KEY, failure("provider unavailable"));
  });

  it("translates a structured backend error", async () => {
    mocks.transcribeEditorImage.mockRejectedValue('@oleafly/error:{"code":"project.name_empty","params":{}}');

    await imageToLatex(image());

    expect(mocks.toast.errorUnique).toHaveBeenCalledExactlyOnceWith(
      KEY,
      failure("Project name cannot be empty."),
    );
  });

  it("reports an unreadable image through the same slot instead of an unhandled rejection", async () => {
    const unreadable = i18n.t(($) => $.researchTools.converterErrors.imageFormat);
    mocks.transcribeEditorImage.mockRejectedValue(new Error(unreadable));

    await expect(imageToLatex(image())).resolves.toBeUndefined();

    expect(mocks.insertAtCursor).not.toHaveBeenCalled();
    expect(mocks.toast.errorUnique).toHaveBeenCalledExactlyOnceWith(KEY, failure(unreadable));
  });

  it.each([
    ["the active file changed", () => { mocks.files.activePath = "chapter.tex"; }],
    ["the project closed", () => { mocks.files.projectId = null; mocks.files.activePath = null; }],
  ])("copies the snippet instead of inserting it when %s", async (_label, change) => {
    mocks.transcribeEditorImage.mockImplementation(async () => {
      change();
      return "x^2";
    });

    await imageToLatex(image());

    expect(mocks.insertAtCursor).not.toHaveBeenCalled();
    expect(mocks.writeText).toHaveBeenCalledExactlyOnceWith("x^2");
    expect(mocks.toast.infoUnique).toHaveBeenLastCalledWith(KEY, i18n.t(($) => $.library.pdfImport.copied));
    expect(mocks.toast.infoUnique).toHaveBeenCalledTimes(2);
    expect(mocks.toast.dismiss).not.toHaveBeenCalled();
  });

  it("keeps the result in a toast with a Copy button when the webview refuses the late clipboard write", async () => {
    mocks.transcribeEditorImage.mockImplementation(async () => {
      mocks.files.activePath = "chapter.tex";
      return "x^2";
    });
    mocks.writeText.mockRejectedValueOnce(new DOMException("not allowed", "NotAllowedError"));

    await imageToLatex(image());

    expect(mocks.toast.errorUnique).not.toHaveBeenCalled();
    const [key, message, action, sticky] = mocks.toast.infoUnique.mock.lastCall as unknown as [
      string,
      string,
      { label: string; onClick: () => void },
      boolean,
    ];
    expect([key, message, sticky]).toEqual([KEY, i18n.t(($) => $.core.imageToLatex.notInserted), true]);
    expect(action.label).toBe(i18n.t(($) => $.common.actions.copy));

    // The click carries the gesture the webview wants.
    action.onClick();
    await vi.waitFor(() => expect(mocks.writeText).toHaveBeenCalledTimes(2));
    expect(mocks.writeText).toHaveBeenLastCalledWith("x^2");
    await vi.waitFor(() =>
      expect(mocks.toast.infoUnique).toHaveBeenLastCalledWith(KEY, i18n.t(($) => $.library.pdfImport.copied)),
    );
  });

  it("says Typst, not LaTeX, when Image to Typst copies its result", async () => {
    mocks.transcribeEditorImage.mockImplementation(async () => {
      mocks.files.activePath = "chapter.typ";
      return "$ x $";
    });
    await imageToTypst(image());
    expect(mocks.toast.infoUnique).toHaveBeenLastCalledWith(KEY, "Copied Typst source");

    mocks.files.activePath = "main.tex";
    mocks.transcribeEditorImage.mockImplementation(async () => {
      mocks.files.activePath = "chapter.typ";
      return "$ x $";
    });
    mocks.writeText.mockRejectedValueOnce(new Error("denied"));
    await imageToTypst(image());
    const [, notice] = mocks.toast.infoUnique.mock.lastCall as unknown as [string, string];
    expect(notice).toBe(i18n.t(($) => $.core.imageToTypst.notInserted));
  });

  it("says the assistant's model read the image when the editor fell back to it", async () => {
    const fallback = { engine: "llm", label: "Claude Opus 5.5", assistantFallback: true };
    mocks.modelInfo.mockReturnValue({ label: "Claude Opus 5.5", sentTo: "Anthropic" });
    mocks.transcribeEditorImage.mockImplementation(
      async (_file: File, _target: string, options: { onModel?: (model: unknown) => void }) => {
        options.onModel?.(fallback);
        return "x^2";
      },
    );

    await imageToLatex(image());

    expect(mocks.toast.infoUnique).toHaveBeenCalledWith(
      KEY,
      "Sending the image to Anthropic (assistant model)…",
      undefined,
      true,
    );
    expect(mocks.insertAtCursor).toHaveBeenCalledWith("x^2");
    expect(mocks.toast.dismiss).not.toHaveBeenCalled();
    expect(mocks.toast.infoUnique).toHaveBeenLastCalledWith(KEY, "Sent to Anthropic (assistant model)");
  });

  it("keeps a newer transcription's progress visible when an older one finishes first", async () => {
    let finishFirst!: (value: string) => void;
    mocks.transcribeEditorImage
      .mockReturnValueOnce(new Promise((resolve) => { finishFirst = resolve; }))
      .mockReturnValueOnce(new Promise(() => {}));

    const first = imageToLatex(image());
    await vi.waitFor(() => expect(mocks.transcribeEditorImage).toHaveBeenCalledTimes(1));
    void imageToLatex(image());
    await vi.waitFor(() => expect(mocks.transcribeEditorImage).toHaveBeenCalledTimes(2));
    finishFirst("a+b");
    await first;

    expect(mocks.insertAtCursor).toHaveBeenCalledWith("a+b");
    expect(mocks.toast.dismiss).not.toHaveBeenCalled();
  });

  it("passes the Typst version for Image to Typst", async () => {
    mocks.files.engine = { id: "typst", typst_resolved: { version: "0.13.1" } };
    mocks.transcribeEditorImage.mockResolvedValueOnce("$ E = m c^2 $");
    await imageToTypst(image());
    expect(mocks.transcribeEditorImage).toHaveBeenCalledWith(
      expect.any(File),
      "Typst",
      expect.objectContaining({ typstVersion: "0.13.1" }),
    );
    expect(mocks.insertAtCursor).toHaveBeenCalledExactlyOnceWith("$ E = m c^2 $");

    mocks.transcribeEditorImage.mockRejectedValueOnce(new Error("offline"));
    await imageToTypst(image());
    expect(mocks.toast.errorUnique).toHaveBeenCalledWith(
      KEY,
      i18n.t(($) => $.core.imageToTypst.failed, { detail: "offline" }),
    );
  });

  it("sends no Typst version for Image to LaTeX", async () => {
    mocks.files.engine = { id: "typst", typst_resolved: { version: "0.13.1" } };
    await imageToLatex(image());
    expect(mocks.transcribeEditorImage).toHaveBeenCalledWith(
      expect.any(File),
      "LaTeX",
      expect.objectContaining({ typstVersion: null }),
    );
  });
});

describe("imageToLatexAvailable", () => {
  beforeEach(() => {
    invalidateConfigCache();
    vi.mocked(getConfig).mockResolvedValue({
      ai_provider: "anthropic",
      ai_keys: { anthropic: "__stored__" },
    } as never);
  });

  it("reads the AI config once when several toolbars ask on project open", async () => {
    await expect(imageToLatexAvailable()).resolves.toBe(true);
    await expect(imageToLatexAvailable()).resolves.toBe(true);

    expect(getConfig).toHaveBeenCalledTimes(1);
  });

  it("reads the config again after the AI settings change", async () => {
    await imageToLatexAvailable();
    window.dispatchEvent(new CustomEvent("oleafly:ai-config-changed"));
    await imageToLatexAvailable();

    expect(getConfig).toHaveBeenCalledTimes(2);
  });

  it("shows the button when any AI is set up and hides it without one", async () => {
    vi.mocked(getConfig).mockResolvedValue({ ai_keys: {} } as never);
    await expect(imageToLatexAvailable()).resolves.toBe(false);

    invalidateConfigCache();
    vi.mocked(getConfig).mockResolvedValue({ ai_keys: { ollama: "http://127.0.0.1:11434" } } as never);
    await expect(imageToLatexAvailable()).resolves.toBe(true);

    invalidateConfigCache();
    vi.mocked(getConfig).mockResolvedValue({
      ai_keys: { ollama: "http://127.0.0.1:11434" },
      ai_tools_model: { provider: "anthropic", model: "claude-opus-5-5" },
    } as never);
    await expect(imageToLatexAvailable()).resolves.toBe(false);
  });

  it("reports unavailable when the config cannot be read", async () => {
    vi.mocked(getConfig).mockRejectedValue(new Error("no backend"));

    await expect(imageToLatexAvailable()).resolves.toBe(false);
  });
});
