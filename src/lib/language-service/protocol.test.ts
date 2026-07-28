import { describe, expect, it } from "vitest";
import { negotiateServerCapabilities } from "./protocol";

const offered = ["utf-8", "utf-16", "utf-32"] as const;

describe("textDocumentSync negotiation", () => {
  it.each([
    [
      0,
      {
        openClose: false,
        change: "none",
        save: { enabled: false, includeText: false },
      },
    ],
    [
      1,
      {
        openClose: true,
        change: "full",
        save: { enabled: false, includeText: false },
      },
    ],
    [
      2,
      {
        openClose: true,
        change: "incremental",
        save: { enabled: false, includeText: false },
      },
    ],
  ])("parses numeric synchronization kind %s", (value, expected) => {
    expect(
      negotiateServerCapabilities(
        { capabilities: { textDocumentSync: value } },
        [...offered],
      ).textDocumentSync,
    ).toEqual(expected);
  });

  it("parses open/close and save options without inventing defaults", () => {
    expect(
      negotiateServerCapabilities(
        {
          capabilities: {
            textDocumentSync: {
              openClose: true,
              change: 2,
              save: { includeText: true },
            },
          },
        },
        [...offered],
      ).textDocumentSync,
    ).toEqual({
      openClose: true,
      change: "incremental",
      save: { enabled: true, includeText: true },
    });
  });

  it("fails closed on malformed synchronization capabilities", () => {
    expect(() =>
      negotiateServerCapabilities(
        { capabilities: { textDocumentSync: 3 } },
        [...offered],
      ),
    ).toThrow("invalid textDocumentSync");
    expect(() =>
      negotiateServerCapabilities(
        {
          capabilities: {
            textDocumentSync: { change: "incremental" },
          },
        },
        [...offered],
      ),
    ).toThrow("invalid textDocumentSync");
  });
});
