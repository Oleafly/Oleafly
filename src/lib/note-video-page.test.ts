// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import script from "../../src-tauri/src/note_video_page.js?raw";

function frameFor(hash: string): HTMLIFrameElement | null {
  window.location.hash = hash;
  new Function(script)();
  return document.body.querySelector("iframe");
}

afterEach(() => {
  document.body.replaceChildren();
  window.location.hash = "";
});

describe("loopback video page script", () => {
  it.each([
    ["#youtube/dQw4w9WgXcQ", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1"],
    ["#youtube/dQw4w9WgXcQ?start=42", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&start=42"],
    ["#youtube/a-b_c1234XY?start=0&h=ff", "https://www.youtube-nocookie.com/embed/a-b_c1234XY?autoplay=1&start=0"],
    ["#vimeo/76979871", "https://player.vimeo.com/video/76979871?autoplay=1&dnt=1"],
    ["#vimeo/76979871?h=0a1b2c", "https://player.vimeo.com/video/76979871?autoplay=1&dnt=1&h=0a1b2c"],
    ["#vimeo/76979871&h=0a1b2c", "https://player.vimeo.com/video/76979871?autoplay=1&dnt=1&h=0a1b2c"],
  ])("frames %s as %s", (hash, src) => {
    const frame = frameFor(hash);
    expect(frame?.src).toBe(src);
    expect(frame?.getAttribute("allow")).toBe("autoplay; encrypted-media; picture-in-picture; fullscreen");
    expect(frame?.hasAttribute("allowfullscreen")).toBe(true);
    expect(frame?.getAttribute("referrerpolicy")).toBe("strict-origin-when-cross-origin");
    expect(frame?.style.width).toBe("100%");
    expect(document.body.querySelectorAll("iframe")).toHaveLength(1);
  });

  it.each([
    "",
    "#",
    "#youtube/",
    "#youtube/short",
    "#youtube/dQw4w9WgXcQQ",
    "#youtube/dQw4w9WgXc%22",
    "#youtube/dQw4w9WgXc\"",
    "#youtube/../../evil",
    "#youtube/dQw4w9WgXcQ?start=1e3",
    "#youtube/dQw4w9WgXcQ?start=-1",
    "#youtube/dQw4w9WgXcQ?start=1234567890",
    "#youtube/dQw4w9WgXcQ/extra",
    "#vimeo/abc",
    "#vimeo/123?h=ABC",
    "#vimeo/123?h=",
    "#vimeo/123/456",
    "#dailymotion/x7abc",
    "#YouTube/dQw4w9WgXcQ",
    "#javascript:alert(1)",
  ])("frames nothing for %s", (hash) => {
    expect(frameFor(hash)).toBeNull();
  });
});
