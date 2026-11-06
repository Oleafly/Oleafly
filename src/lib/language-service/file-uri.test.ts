import { describe, expect, it } from "vitest";
import { fileUriForProjectPath, projectPathForUri } from "./file-uri";

describe("project paths and file URIs", () => {
  it.each([
    ["/home/ada/paper"],
    ["/home/ada/R&D+notes"],
    ["C:\\Users\\Ana María\\paper"],
    ["\\\\?\\D:\\typst-project"],
    ["\\\\?\\D:\\"],
    ["D:\\"],
    ["\\\\server\\share\\paper"],
    ["\\\\?\\UNC\\server\\share\\paper"],
    ["\\\\?\\UNC\\SERVER\\Share\\paper"],
    ["\\\\?\\UNC\\server\\share"],
  ])("round-trips a file under %s", (root) => {
    for (const path of ["main.typ", "chapters/a b/intro#1.typ", "R&D/é+x@y.typ"]) {
      expect(projectPathForUri(root, fileUriForProjectPath(root, path))).toBe(path);
    }
  });

  it("gives the verbatim and everyday spellings of a folder the same URI", () => {
    expect(fileUriForProjectPath("\\\\?\\D:\\paper", "main.typ")).toBe(
      fileUriForProjectPath("D:\\paper", "main.typ"),
    );
    expect(fileUriForProjectPath("\\\\?\\UNC\\server\\share\\paper", "main.typ")).toBe(
      fileUriForProjectPath("\\\\server\\share\\paper", "main.typ"),
    );
  });

  it("never lets the verbatim prefix into a URI", () => {
    for (const root of ["\\\\?\\D:\\paper", "\\\\?\\UNC\\server\\share\\paper"]) {
      expect(fileUriForProjectPath(root)).not.toMatch(/%3F|UNC/);
      expect(fileUriForProjectPath(root, "main.typ")).not.toMatch(/%3F|UNC/);
    }
  });
});
