import { describe, expect, it } from "vitest";
import {
  applySlideAction,
  formatElapsed,
  presentationQuery,
  readPresentationParams,
  slideActionForKey,
  type PresentationParams,
} from "./navigation";

describe("slideActionForKey", () => {
  it.each([
    ["ArrowRight", "next"],
    ["ArrowDown", "next"],
    ["PageDown", "next"],
    [" ", "next"],
    ["Enter", "next"],
    ["n", "next"],
    ["ArrowLeft", "previous"],
    ["ArrowUp", "previous"],
    ["PageUp", "previous"],
    ["Backspace", "previous"],
    ["p", "previous"],
    ["Home", "first"],
    ["End", "last"],
    ["Escape", "end"],
    ["b", "blank"],
    [".", "blank"],
  ])("maps %s to %s", (key, action) => {
    expect(slideActionForKey({ key })).toBe(action);
  });

  it("leaves shortcuts with modifiers and other keys alone", () => {
    expect(slideActionForKey({ key: "ArrowRight", metaKey: true })).toBeNull();
    expect(slideActionForKey({ key: "p", ctrlKey: true })).toBeNull();
    expect(slideActionForKey({ key: "x" })).toBeNull();
  });
});

describe("applySlideAction", () => {
  it("moves within the deck", () => {
    expect(applySlideAction("next", 1, 3)).toBe(2);
    expect(applySlideAction("next", 3, 3)).toBe(3);
    expect(applySlideAction("previous", 1, 3)).toBe(1);
    expect(applySlideAction("first", 3, 3)).toBe(1);
    expect(applySlideAction("last", 1, 3)).toBe(3);
    expect(applySlideAction("blank", 2, 3)).toBe(2);
  });
});

describe("formatElapsed", () => {
  it("shows minutes and seconds, and hours once needed", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(65_000)).toBe("1:05");
    expect(formatElapsed(3_723_000)).toBe("1:02:03");
    expect(formatElapsed(-5)).toBe("0:00");
  });
});

describe("presentation parameters", () => {
  const params: PresentationParams = {
    session: "s1",
    projectId: "deck",
    source: { kind: "file", path: "slides/talk.pdf" },
    start: 4,
    presenter: true,
    main: "main.typ",
    typst: true,
  };

  it("round trip through the window address", () => {
    const query = presentationQuery(params, "presenter");
    expect(query.get("view")).toBe("presenter");
    expect(readPresentationParams(`?${query.toString()}`)).toEqual(params);
  });

  it("default to the compiled PDF from the first page", () => {
    const query = presentationQuery({ ...params, source: { kind: "compiled" }, start: 1, presenter: false, main: null, typst: false }, "present");
    expect(readPresentationParams(`?${query.toString()}`)).toEqual({
      session: "s1",
      projectId: "deck",
      source: { kind: "compiled" },
      start: 1,
      presenter: false,
      main: null,
      typst: false,
    });
  });

  it("carry the Typst variant and offline mode the slides were compiled with", () => {
    const compiled: PresentationParams = { ...params, source: { kind: "compiled" }, variant: "camera-ready", offline: true };
    const query = presentationQuery(compiled, "presenter");
    expect(query.get("variant")).toBe("camera-ready");
    expect(query.get("offline")).toBe("1");
    expect(readPresentationParams(`?${query.toString()}`)).toEqual(compiled);
    const plain = presentationQuery({ ...compiled, variant: null, offline: false }, "present");
    expect(plain.has("variant")).toBe(false);
    expect(plain.has("offline")).toBe(false);
    const read = readPresentationParams(`?${plain.toString()}`);
    expect(read?.variant).toBeUndefined();
    expect(read?.offline).toBeUndefined();
  });

  it("reject addresses without a project or session", () => {
    expect(readPresentationParams("?view=present")).toBeNull();
    expect(readPresentationParams("?view=present&project=a")).toBeNull();
    expect(readPresentationParams("?view=present&project=a&session=s&source=file")).toBeNull();
    expect(readPresentationParams("?view=present&project=a&session=s&start=-3")?.start).toBe(1);
  });
});
