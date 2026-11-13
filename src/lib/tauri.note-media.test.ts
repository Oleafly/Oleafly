import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, Channel: class {} }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setFocus: vi.fn(async () => {}) }) }));

import { noteLinkPreview, noteVideoFrameOrigin, readNoteFile } from "./tauri";

beforeEach(() => {
  mocks.invoke.mockReset().mockResolvedValue("ok");
});

describe("note media commands", () => {
  it("asks for the loopback video page's origin without sending anything", async () => {
    await expect(noteVideoFrameOrigin()).resolves.toBe("ok");
    expect(mocks.invoke).toHaveBeenCalledWith("note_video_frame_origin");
    expect(mocks.invoke.mock.calls[0]).toHaveLength(1);
  });

  it("reads a note's audio, video or PDF file as raw bytes", async () => {
    const bytes = new ArrayBuffer(4);
    mocks.invoke.mockResolvedValueOnce(bytes);
    await expect(readNoteFile("project-1", "assets/talk.mp4")).resolves.toBe(bytes);
    expect(mocks.invoke).toHaveBeenCalledWith("read_note_file", { projectId: "project-1", relPath: "assets/talk.mp4" });
  });

  it("fetches a bookmark card's preview for a link", async () => {
    const preview = {
      url: "https://example.org/a",
      title: "A",
      description: null,
      siteName: "Example",
      image: null,
      favicon: "https://example.org/favicon.ico",
    };
    mocks.invoke.mockResolvedValueOnce(preview);
    await expect(noteLinkPreview("https://example.org/a")).resolves.toEqual(preview);
    expect(mocks.invoke).toHaveBeenCalledWith("note_link_preview", { url: "https://example.org/a" });
  });
});
