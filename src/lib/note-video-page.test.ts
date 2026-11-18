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
    ["#x/20", "https://platform.twitter.com/embed/Tweet.html?id=20&dnt=true"],
    ["#x/20?theme=dark", "https://platform.twitter.com/embed/Tweet.html?id=20&dnt=true&theme=dark"],
    ["#x/1234567890123456789?theme=light", "https://platform.twitter.com/embed/Tweet.html?id=1234567890123456789&dnt=true&theme=light"],
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
    "#x/",
    "#x/abc",
    "#x/123456789012345678901",
    "#x/20?theme=blue",
    "#x/20?theme=",
    "#x/20/extra",
    "#X/20",
    "#dailymotion/x7abc",
    "#YouTube/dQw4w9WgXcQ",
    "#javascript:alert(1)",
  ])("frames nothing for %s", (hash) => {
    expect(frameFor(hash)).toBeNull();
  });

  it.each([
    ["#youtube/dQw4w9WgXcQ", "YouTube", "rgb(0, 0, 0)"],
    ["#vimeo/76979871", "Vimeo", "rgb(0, 0, 0)"],
    ["#x/20", "X", "transparent"],
  ])("names the player for %s and sets the page background", (hash, title, background) => {
    expect(frameFor(hash)?.title).toBe(title);
    expect(document.documentElement.style.background).toBe(background);
  });
});
