import { describe, expect, it } from "vitest";
import { baseName, dataUrlToBase64, zipEntries } from "./import";

describe("baseName", () => {
  it("strips extension and directories", () => {
    expect(baseName("My Paper.final.pdf")).toBe("My Paper.final");
    expect(baseName("report.docx")).toBe("report");
    expect(baseName("dir/sub/report.pdf")).toBe("report");
  });

  it("keeps extensionless names", () => {
    expect(baseName("notes")).toBe("notes");
  });
});

describe("dataUrlToBase64", () => {
  it("strips the data url prefix", () => {
    expect(dataUrlToBase64("data:image/png;base64,AAAA")).toBe("AAAA");
  });
});

describe("zipEntries", () => {
  it("bundles main.tex and figures under assets/", () => {
    const entries = zipEntries("\\documentclass{article}", [
      { name: "figure_p1_1.png", page: 1, pngDataUrl: "data:image/png;base64,AAAA" },
    ]);
    expect(Object.keys(entries)).toEqual(["main.tex", "assets/figure_p1_1.png"]);
    expect(entries["assets/figure_p1_1.png"]).toBeInstanceOf(Uint8Array);
  });
});
