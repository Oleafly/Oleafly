// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import page from "../../src-tauri/src/note_video_page.js?raw";

const APP_ORIGIN = "tauri://localhost";
const script = page.replace('"__OLEAFLY_APP_ORIGIN__"', JSON.stringify(APP_ORIGIN));

function frameFor(hash: string): HTMLIFrameElement | null {
  window.location.hash = hash;
  new Function(script)();
  return document.body.querySelector("iframe");
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  document.documentElement.removeAttribute("style");
  window.location.hash = "";
});

const X_ORIGIN = "https://platform.twitter.com";

function fromX(frame: HTMLIFrameElement | null, data: unknown, origin = X_ORIGIN, source: Window | null = frame?.contentWindow ?? null) {
  window.dispatchEvent(new MessageEvent("message", { data, origin, source }));
}

function call(method: string, params: unknown[] = [{}]) {
  return { "twttr.embed": { jsonrpc: "2.0", method, id: "", params } };
}

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
    expect(frame?.getAttribute("scrolling")).toBe("no");
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

  it.each([
    ["#x/20?theme=dark", "dark"],
    ["#x/20?theme=light", "light"],
    ["#x/20", "normal"],
  ])("matches the app's colour scheme for %s so the page stays see-through", (hash, scheme) => {
    const frame = frameFor(hash);
    expect(document.documentElement.style.colorScheme).toBe(scheme);
    expect(frame?.style.colorScheme).toBe("normal");
  });

  it("passes the post's height and a missing post from X up to the app", () => {
    const sent = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
    const frame = frameFor("#x/20?theme=dark");
    fromX(frame, call("twttr.private.resize", [{ height: 224.4, width: 550, data: { tweet_id: "20" } }]));
    fromX(frame, JSON.stringify(call("twttr.private.resize", [{ height: 528 }])));
    fromX(frame, call("twttr.private.no_results"));
    expect(sent.mock.calls).toEqual([
      [{ source: "oleafly-x-post", height: 225 }, APP_ORIGIN],
      [{ source: "oleafly-x-post", height: 528 }, APP_ORIGIN],
      [{ source: "oleafly-x-post", missing: true }, APP_ORIGIN],
    ]);
  });

  it("ignores anything that is not a size or a missing post from the X frame it made", () => {
    const sent = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
    const frame = frameFor("#x/20");
    const other = document.createElement("iframe");
    document.body.append(other);
    fromX(frame, call("twttr.private.resize", [{ height: 300 }]), "https://evil.example");
    fromX(frame, call("twttr.private.resize", [{ height: 300 }]), X_ORIGIN, other.contentWindow);
    for (const height of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, 20001, "300", null]) {
      fromX(frame, call("twttr.private.resize", [{ height }]));
    }
    fromX(frame, call("twttr.private.resize", []));
    fromX(frame, call("twttr.private.resize", null as unknown as unknown[]));
    fromX(frame, call("twttr.private.rendered"));
    fromX(frame, call("twttr.private.trigger", [{ type: "click" }]));
    fromX(frame, "{not json");
    fromX(frame, { height: 300 });
    fromX(frame, null);
    expect(sent).not.toHaveBeenCalled();
  });

  it("forwards nothing for a video player", () => {
    const sent = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {});
    const frame = frameFor("#youtube/dQw4w9WgXcQ");
    fromX(frame, call("twttr.private.resize", [{ height: 300 }]));
    expect(sent).not.toHaveBeenCalled();
  });
});
