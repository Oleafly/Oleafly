import { EditorSelection, EditorState } from "@codemirror/state";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftAttachment } from "@/components/ai/composer/types";
import type { FileEntry } from "@/lib/tauri";
import type { AcpPromptDraft } from "@/store/acp-sessions";
import { initTestI18n, session } from "./tests/ui-fixtures";

const mocks = vi.hoisted(() => ({
  attachmentRead: vi.fn(),
  normalizeImage: vi.fn(),
  view: null as null | { state: EditorState },
  activePath: "chapters/main.tex" as string | null,
}));

vi.mock("@/lib/attachments", () => ({ attachmentRead: mocks.attachmentRead }));
vi.mock("@/lib/image-normalize", () => ({ normalizeImage: mocks.normalizeImage }));
vi.mock("@/components/editor/cm/controller", () => ({ getEditorView: () => mocks.view }));
vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => ({ activePath: mocks.activePath }) },
}));

const {
  AcpPromptError,
  MAX_ACP_ATTACHMENTS,
  PROMPT_BUDGET,
  imageByteBudget,
  prepareImages,
  promptErrorMessage,
  promptMentions,
  quoteSelection,
  toPromptInput,
} = await import("./acp-attachments");

function attachment(name: string, overrides: Partial<DraftAttachment> = {}): DraftAttachment {
  const kind = overrides.kind ?? (name.endsWith(".png") ? "image" : name.endsWith(".pdf") ? "pdf" : "text");
  const mime = kind === "image" ? "image/png" : kind === "pdf" ? "application/pdf" : "text/plain";
  return { id: name, name, mime, size: 10, status: "ready", kind, scope: "paper", sha256: `sha-${name}`, ...overrides };
}

function draft(overrides: Partial<AcpPromptDraft> = {}): AcpPromptDraft {
  return { text: "Hello", attachments: [], mentions: [], selections: [], skill: null, ...overrides };
}

function bytes(length: number): ArrayBuffer {
  return new Uint8Array(length).fill(7).buffer;
}

const tree: FileEntry[] = [
  { path: "chapters", is_dir: true },
  { path: "chapters/intro.tex", is_dir: false },
  { path: "figures", is_dir: true },
];

const imageSession = () => {
  const value = session("s");
  value.capabilities = { ...value.capabilities, image: true };
  return value;
};

async function rejection(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (reason: unknown) => reason);
  expect(error).toBeInstanceOf(AcpPromptError);
  return (error as InstanceType<typeof AcpPromptError>).reason;
}

beforeAll(async () => {
  await initTestI18n();
});

beforeEach(() => {
  mocks.attachmentRead.mockReset();
  mocks.normalizeImage.mockReset();
  mocks.view = null;
  mocks.activePath = "chapters/main.tex";
});

describe("CLI prompt attachments", () => {
  it("splits the frame budget between images", () => {
    expect(PROMPT_BUDGET).toBe(1024 * 1024 - 1024);
    expect(imageByteBudget(1000, 0, 3)).toBe(Math.floor(((1048576 - 1024 - 512 - 1000) * 0.75) / 3));
    expect(imageByteBudget(1000, 0, 0)).toBe(0);
  });

  it("keeps a small image as it is", async () => {
    mocks.attachmentRead.mockResolvedValue(bytes(100 * 1024));
    const images = await prepareImages([attachment("plot.png")], 200 * 1024);
    expect(images).toHaveLength(1);
    expect(images[0].mimeType).toBe("image/png");
    expect(atob(images[0].data)).toHaveLength(100 * 1024);
    expect(mocks.attachmentRead).toHaveBeenCalledWith("paper", "sha-plot.png");
    expect(mocks.normalizeImage).not.toHaveBeenCalled();
  });

  it("re-encodes a large image until it fits", async () => {
    mocks.attachmentRead.mockResolvedValue(bytes(3 * 1024 * 1024));
    mocks.normalizeImage
      .mockResolvedValueOnce({ bytes: new Uint8Array(2 * 1024 * 1024), mime: "image/jpeg", width: 1536, height: 1000, thumbnailUrl: "" })
      .mockResolvedValueOnce({ bytes: new Uint8Array(500 * 1024), mime: "image/jpeg", width: 1024, height: 666, thumbnailUrl: "" });
    const images = await prepareImages([attachment("scan.png")], 1024 * 1024);
    expect(mocks.normalizeImage.mock.calls.map(([, options]) => options)).toEqual([
      { maxEdge: 1536, thumbEdge: 32 },
      { maxEdge: 1024, thumbEdge: 32 },
    ]);
    const file = mocks.normalizeImage.mock.calls[0][0] as File;
    expect(file.name).toBe("scan.png");
    expect(file.type).toBe("image/png");
    expect(images).toEqual([{ mimeType: "image/jpeg", data: expect.any(String) }]);
    expect(atob(images[0].data)).toHaveLength(500 * 1024);
  });

  it("gives up on an image that is too large even at the smallest size", async () => {
    mocks.attachmentRead.mockResolvedValue(bytes(3 * 1024 * 1024));
    mocks.normalizeImage.mockResolvedValue({ bytes: new Uint8Array(900 * 1024), mime: "image/jpeg", width: 512, height: 300, thumbnailUrl: "" });
    expect(await rejection(prepareImages([attachment("huge.png")], 100 * 1024))).toBe("tooLarge");
    expect(mocks.normalizeImage).toHaveBeenCalledTimes(4);
    expect(mocks.normalizeImage.mock.calls.map(([, options]) => (options as { maxEdge: number }).maxEdge)).toEqual([1536, 1024, 768, 512]);
  });

  it("treats an image without a stored copy as not ready", async () => {
    expect(await rejection(prepareImages([attachment("plot.png", { sha256: undefined })], 1024))).toBe("notReady");
    expect(mocks.attachmentRead).not.toHaveBeenCalled();
  });

  it("refuses images the agent cannot read", async () => {
    const input = toPromptInput(draft({ attachments: [attachment("plot.png")] }), session("s"), tree);
    expect(await rejection(input)).toBe("imagesUnsupported");
  });

  it("refuses more than ten attachments", async () => {
    const files = Array.from({ length: MAX_ACP_ATTACHMENTS + 1 }, (_, index) => attachment(`paper-${index}.pdf`));
    expect(await rejection(toPromptInput(draft({ attachments: files }), session("s"), tree))).toBe("tooMany");
  });

  it("counts mentioned files and quotes toward the ten", async () => {
    const files = Array.from({ length: 8 }, (_, index) => attachment(`paper-${index}.pdf`));
    const selections = [
      { id: "a", path: "main.tex", text: "one", label: "main.tex:1-1" },
      { id: "b", path: "main.tex", text: "two", label: "main.tex:2-2" },
    ];
    const input = toPromptInput(
      draft({ text: "Compare with @chapters/intro.tex", attachments: files, selections }),
      session("s"),
      tree,
    );
    expect(await rejection(input)).toBe("tooMany");
  });

  it("waits for attachments that are still being prepared", async () => {
    const pending = attachment("paper.pdf", { status: "processing", sha256: undefined });
    expect(await rejection(toPromptInput(draft({ attachments: [pending] }), session("s"), tree))).toBe("notReady");
    const unstored = attachment("notes.txt", { sha256: undefined });
    expect(await rejection(toPromptInput(draft({ attachments: [unstored] }), session("s"), tree))).toBe("notReady");
  });

  it("refuses a message longer than 256 KiB", async () => {
    const text = "x".repeat(256 * 1024 + 1);
    expect(await rejection(toPromptInput(draft({ text }), session("s"), tree))).toBe("tooLarge");
  });

  it("sends stored files and mentioned project files as references", async () => {
    const input = await toPromptInput(
      draft({
        text: "Check @chapters/intro.tex against @figures and the PDF",
        attachments: [attachment("paper.pdf", { sha256: "ab12" })],
        skill: { id: "oleafly-literature-sweep", name: "Literature sweep" },
      }),
      session("s"),
      tree,
    );
    expect(input).toEqual({
      text: "Check @chapters/intro.tex against @figures and the PDF",
      images: [],
      files: [
        { kind: "stored", sha256: "ab12", name: "paper.pdf", mime: "application/pdf" },
        { kind: "project", path: "chapters/intro.tex" },
      ],
      selections: [],
      skillId: "oleafly-literature-sweep",
    });
  });

  it("uses the mentions read when it was queued when the window shows another project", async () => {
    const queued = draft({ text: "Tighten @chapters/results.tex", mentions: ["chapters/results.tex"] });
    const input = await toPromptInput(queued, session("s"), null);
    expect(input.files).toEqual([{ kind: "project", path: "chapters/results.tex" }]);
    const shown = await toPromptInput(queued, session("s"), tree);
    expect(shown.files).toEqual([]);
  });

  it("reads the files a message mentions, leaving folders out", () => {
    expect(promptMentions("See @chapters/intro.tex and @figures/", tree)).toEqual(["chapters/intro.tex"]);
    expect(promptMentions("Nothing here", tree)).toEqual([]);
  });

  it("sends images inline within the frame budget", async () => {
    mocks.attachmentRead.mockResolvedValue(bytes(1024));
    const input = await toPromptInput(draft({ attachments: [attachment("plot.png")] }), imageSession(), tree);
    expect(input.images).toEqual([{ mimeType: "image/png", data: expect.any(String) }]);
    expect(input.files).toEqual([]);
    expect(input.skillId).toBeNull();
  });

  it("caps each quoted selection at 64 KiB", async () => {
    const selections = [{ id: "a", path: "main.tex", text: "y".repeat(70 * 1024), label: "main.tex:1-900" }];
    const input = await toPromptInput(draft({ selections }), session("s"), tree);
    expect(input.selections).toEqual([{ path: "main.tex", text: "y".repeat(64 * 1024) }]);
  });

  it("explains each problem in words", () => {
    expect(promptErrorMessage(new AcpPromptError("tooLarge"))).toBe(
      "This message and its images are too large. Shorten the message or remove an image.",
    );
    expect(promptErrorMessage(new AcpPromptError("tooMany"))).toBe("Attach up to 10 files to one message.");
    expect(promptErrorMessage(new AcpPromptError("imagesUnsupported"))).toBe(
      "This agent does not accept images. Remove them and try again.",
    );
    expect(promptErrorMessage(new AcpPromptError("notReady"))).toBe("Wait for the attachments to finish preparing.");
    expect(promptErrorMessage(new Error("other"))).toBeNull();
    expect(new AcpPromptError("tooMany").name).toBe("AcpPromptError");
  });
});

describe("quoting the editor selection", () => {
  const doc = ["line one", "line two", "selected start", "selected end", "line five"].join("\n");
  const at = (line: number) => doc.split("\n").slice(0, line - 1).join("\n").length + 1;

  it("quotes the editor selection with its file and lines", async () => {
    const from = at(3);
    const to = at(4) + "selected end".length;
    mocks.view = { state: EditorState.create({ doc, selection: EditorSelection.single(from, to) }) };
    const quote = await quoteSelection();
    expect(quote).toMatchObject({
      path: "chapters/main.tex",
      text: "selected start\nselected end",
      label: "main.tex:3-4",
    });
    expect(quote?.id).toMatch(/^selection-\d+-\d+$/);
  });

  it("labels a quote by lines when no file is active", async () => {
    mocks.activePath = null;
    mocks.view = { state: EditorState.create({ doc, selection: EditorSelection.single(at(2), at(2) + 4) }) };
    expect(await quoteSelection()).toMatchObject({ path: null, text: "line", label: "2" });
  });

  it("does not count the next line when a triple-click selects a whole line", async () => {
    mocks.view = { state: EditorState.create({ doc, selection: EditorSelection.single(at(3), at(4)) }) };
    expect(await quoteSelection()).toMatchObject({ text: "selected start\n", label: "main.tex:3" });
    mocks.view = { state: EditorState.create({ doc, selection: EditorSelection.single(at(3), at(5)) }) };
    expect(await quoteSelection()).toMatchObject({ label: "main.tex:3-4" });
  });

  it("quotes nothing without an editor, a selection or visible text", async () => {
    expect(await quoteSelection()).toBeNull();
    mocks.view = { state: EditorState.create({ doc, selection: EditorSelection.cursor(3) }) };
    expect(await quoteSelection()).toBeNull();
    const spaced = "a   \n   b";
    mocks.view = { state: EditorState.create({ doc: spaced, selection: EditorSelection.single(1, 7) }) };
    expect(await quoteSelection()).toBeNull();
  });
});
