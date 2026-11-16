import { describe, expect, it } from "vitest";
import { type BoardCamera, boardCamera, boardLanguage, readBoardScene, rememberBoardCamera } from "./board-scene";

describe("readBoardScene", () => {
  it("opens an empty file as a blank board", () => {
    expect(readBoardScene("")).toEqual({ elements: [], appState: {}, files: {} });
    expect(readBoardScene("  \n")).toEqual({ elements: [], appState: {}, files: {} });
  });

  it("reads the elements, settings and images of an Excalidraw file", () => {
    const file = {
      type: "excalidraw",
      version: 2,
      source: "https://excalidraw.com",
      elements: [{ id: "a", type: "rectangle" }],
      appState: { viewBackgroundColor: "#fff", gridModeEnabled: true },
      files: { img: { id: "img", mimeType: "image/png", dataURL: "data:image/png;base64,AA" } },
    };
    expect(readBoardScene(JSON.stringify(file))).toEqual({
      elements: file.elements,
      appState: file.appState,
      files: file.files,
    });
    expect(readBoardScene(JSON.stringify({ elements: [] }))).toEqual({ elements: [], appState: {}, files: {} });
  });

  it("refuses anything that is not an Excalidraw drawing", () => {
    expect(readBoardScene("{")).toBeNull();
    expect(readBoardScene("[]")).toBeNull();
    expect(readBoardScene(JSON.stringify({ type: "excalidraw/library", libraryItems: [] }))).toBeNull();
    expect(readBoardScene(JSON.stringify({ type: "excalidraw", elements: {} }))).toBeNull();
  });
});

describe("boardLanguage", () => {
  const codes = ["en", "de-DE", "pt-BR", "pt-PT", "zh-CN", "zh-TW", "ja-JP"];

  it("picks Excalidraw's translation for the interface language", () => {
    expect(boardLanguage("de", codes)).toBe("de-DE");
    expect(boardLanguage("pt-BR", codes)).toBe("pt-BR");
    expect(boardLanguage("zh-Hans", codes)).toBe("zh-CN");
    expect(boardLanguage("zh-Hant", codes)).toBe("zh-TW");
    expect(boardLanguage("ja", codes)).toBe("ja-JP");
    expect(boardLanguage("en", codes)).toBe("en");
    expect(boardLanguage("sv", codes)).toBe("en");
  });
});

describe("board cameras", () => {
  it("remember where each board was left", () => {
    expect(boardCamera("p:a.excalidraw")).toBeUndefined();
    const camera = { scrollX: 10, scrollY: -4, zoom: { value: 1.5 } } as unknown as BoardCamera;
    rememberBoardCamera("p:a.excalidraw", camera);
    expect(boardCamera("p:a.excalidraw")).toEqual({ scrollX: 10, scrollY: -4, zoom: { value: 1.5 } });
    expect(boardCamera("p:b.excalidraw")).toBeUndefined();
  });
});
