import { describe, expect, it } from "vitest";
import { assetFragment, noteMediaExtension, noteMediaKind, noteMediaType, playsInNote, type VideoEmbed, videoEmbed, videoFramePage } from "./note-path";

function embedOf(link: string): VideoEmbed {
  const embed = videoEmbed(link);
  if (!embed) throw new Error(`${link} is not a video link`);
  return embed;
}

describe("media and video links", () => {
  it("knows audio, video and PDF files by their extension, ignoring a page link", () => {
    expect(noteMediaKind("assets/talk.MP4")).toBe("video");
    expect(noteMediaKind("assets/memo.m4a")).toBe("audio");
    expect(noteMediaKind("assets/paper.pdf#page=4")).toBe("pdf");
    expect(noteMediaKind("assets/plot.png")).toBeNull();
    expect(noteMediaKind("https://example.org/a.mp3")).toBeNull();
    expect(assetFragment("assets/paper.pdf#page=12")).toEqual({ file: "assets/paper.pdf", page: 12 });
    expect(assetFragment("assets/paper.pdf#page=0")).toEqual({ file: "assets/paper.pdf", page: null });
    expect(noteMediaType("a.webm")).toBe("video/webm");
    expect(noteMediaType("a.bin")).toBe("application/octet-stream");
  });

  it("names the file a known audio, video or PDF type is saved as, and nothing for other types", () => {
    expect(noteMediaExtension("audio/mpeg")).toBe("mp3");
    expect(noteMediaExtension("audio/mp4")).toBe("m4a");
    expect(noteMediaExtension("Video/MP4; codecs=avc1")).toBe("mp4");
    expect(noteMediaExtension("application/pdf")).toBe("pdf");
    expect(noteMediaExtension("video/x-matroska")).toBeNull();
    expect(noteMediaExtension("audio/x-ms-wma")).toBeNull();
    expect(noteMediaExtension("")).toBeNull();
  });

  it("knows which sources play in the note rather than show a picture", () => {
    expect(playsInNote("assets/talk.mp4")).toBe(true);
    expect(playsInNote("assets/memo.m4a")).toBe(true);
    expect(playsInNote("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
    expect(playsInNote("assets/paper.pdf#page=2")).toBe(false);
    expect(playsInNote("assets/plot.png")).toBe(false);
  });

  it("keeps a Vimeo private-link hash only when it is hex, so a link can't add player settings", () => {
    const injected = videoEmbed("https://vimeo.com/123456789?h=abc%26dnt%3D0%26autoplay%3D1");
    expect(injected?.frame).toBe("https://player.vimeo.com/video/123456789?dnt=1");
    expect(injected?.page).toBe("https://vimeo.com/123456789");
    expect(injected?.hash).toBeNull();
    expect(videoEmbed("https://vimeo.com/123456789/a1b2c3d4e5?h=x%26dnt%3D0")?.hash).toBe("a1b2c3d4e5");
    expect(videoEmbed("https://player.vimeo.com/video/123456789?h=a1b2c3d4e5")?.frame).toBe(
      "https://player.vimeo.com/video/123456789?dnt=1&h=a1b2c3d4e5",
    );
  });

  it("points the in-app player page at the video, its start and its private-link hash", () => {
    const origin = "http://127.0.0.1:4545";
    expect(videoFramePage(embedOf("https://youtu.be/dQw4w9WgXcQ?t=90"), origin)).toBe(
      "http://127.0.0.1:4545/video#youtube/dQw4w9WgXcQ?start=90",
    );
    expect(videoFramePage(embedOf("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), origin)).toBe(
      "http://127.0.0.1:4545/video#youtube/dQw4w9WgXcQ",
    );
    expect(videoFramePage(embedOf("https://vimeo.com/76979871/a1b2c3d4e5"), origin)).toBe(
      "http://127.0.0.1:4545/video#vimeo/76979871?h=a1b2c3d4e5",
    );
  });

  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?t=90", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"],
    ["https://vimeo.com/76979871", "https://player.vimeo.com/video/76979871?dnt=1"],
    ["https://vimeo.com/76979871/a1b2c3d4e5", "https://player.vimeo.com/video/76979871?dnt=1&h=a1b2c3d4e5"],
  ])("plays %s through %s", (link, frame) => {
    expect(videoEmbed(link)?.frame).toBe(frame);
  });

  it.each(["http://youtu.be/dQw4w9WgXcQ", "https://youtube.com/watch?v=short", "https://example.org/watch?v=dQw4w9WgXcQ", "https://vimeo.com/about", "not a link"])(
    "plays nothing for %s",
    (link) => {
      expect(videoEmbed(link)).toBeNull();
    },
  );
});
