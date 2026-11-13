// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectInfo } from "@oleafly/backend-port";
import "./tests/setup";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };

const mocks = vi.hoisted(() => ({
  readFileContent: vi.fn(),
  convertNote: vi.fn(),
  projectCitations: vi.fn(),
  flushOpenNotes: vi.fn(),
  notesRenderTikz: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  readFileContent: mocks.readFileContent,
  readProjectBytes: vi.fn(),
  notesRenderTikz: mocks.notesRenderTikz,
}));
vi.mock("@/lib/open-note-editors", () => ({ flushOpenNotes: mocks.flushOpenNotes }));
vi.mock("./note-citations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./note-citations")>()),
  projectCitations: mocks.projectCitations,
}));
vi.mock("./note-export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./note-export")>()),
  convertNote: mocks.convertNote,
}));

import { notePage, noteSourceId, webPageBody } from "./note-publish";

function note(overrides: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    id: "local-7",
    name: "Field notes",
    main_doc: "note.md",
    kind: "note",
    related_project: null,
    ...overrides,
  } as ProjectInfo;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.flushOpenNotes.mockResolvedValue([]);
  mocks.projectCitations.mockResolvedValue([]);
});

describe("a note's public page body", () => {
  it("drops the title block, turns task boxes into marks and remote images into links", () => {
    const body = webPageBody(
      [
        "<!doctype html><html><head><title>x</title><style>p{}</style></head><body>",
        '<header id="title-block-header"><h1 class="title">Field notes</h1></header>',
        '<ul class="task-list"><li><label><input type="checkbox" checked="" />Done</label></li>',
        '<li><label><input type="checkbox" />Open</label></li></ul>',
        '<p><img src="https://example.org/plot.png" alt="Plot" /><img src="data:image/png;base64,AAAA" alt="Kept" /></p>',
        "</body></html>",
      ].join(""),
    );
    expect(body).not.toContain("title-block-header");
    expect(body).not.toContain("<input");
    expect(body).toContain("\u2611 Done");
    expect(body).toContain("\u2610 Open");
    expect(body).toContain('<a href="https://example.org/plot.png">Plot</a>');
    expect(body).toContain('src="data:image/png;base64,AAAA"');
    expect(body).not.toContain("<style>");
  });
});

describe("publishing a note", () => {
  it("names the page by the note's own id so every device updates the same page", async () => {
    expect(await noteSourceId(note(), "---\nid: n-42\ntitle: x\n---\n")).toBe("n-42");
    expect(await noteSourceId(note(), "No front matter")).toBe("local-7");
  });

  it("saves open editors, renders the note through the HTML export and keeps only the body", async () => {
    mocks.readFileContent.mockResolvedValue("---\nid: n-42\n---\n\nHello **world**");
    mocks.convertNote.mockResolvedValue({
      text: '<html><body><header id="title-block-header"><h1>Field notes</h1></header><p>Hello <strong>world</strong></p></body></html>',
    });
    const page = await notePage(note({ related_project: "paper-1" }));
    expect(mocks.flushOpenNotes).toHaveBeenCalledOnce();
    expect(mocks.readFileContent).toHaveBeenCalledWith("local-7", "note.md");
    expect(mocks.projectCitations).toHaveBeenCalledWith("paper-1");
    const [text, format] = mocks.convertNote.mock.calls[0];
    expect(format).toBe("html");
    expect(text).toContain('title: "Field notes"');
    expect(text).toContain("Hello **world**");
    expect(page).toEqual({ source: "n-42", title: "Field notes", html: "<p>Hello <strong>world</strong></p>" });
  });

  it("leaves an undrawn TikZ block out of a shared note instead of running LaTeX for it", async () => {
    mocks.readFileContent.mockResolvedValue("Before\n\n```tikz\n\\draw (0,0) -- (1,1);\n```\n\nAfter");
    mocks.notesRenderTikz.mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    mocks.convertNote.mockResolvedValue({ text: "<html><body><p>Before</p></body></html>" });
    await notePage(note({ shared: { server_id: "lab", server_name: "Lab", role: "owner" } as ProjectInfo["shared"] }));
    expect(mocks.notesRenderTikz).not.toHaveBeenCalled();
    const [text] = mocks.convertNote.mock.calls[0];
    expect(text).toContain(enNotes.sendToPaper.leftOut.replace("{{block}}", "TikZ"));
    expect(text).not.toContain("data:image/svg");
  });
});
