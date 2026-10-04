import { beforeEach, describe, expect, it, vi } from "vitest";

const readFileContent = vi.hoisted(() => vi.fn());

vi.mock("@/lib/tauri", async (original) => ({
  ...(await original<typeof import("@/lib/tauri")>()),
  readFileContent,
}));

import { mentionAttachments } from "./ChatCore";

function decoded(dataUrl: string): string {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return new TextDecoder().decode(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)));
}

beforeEach(() => {
  readFileContent.mockReset();
});

describe("mentionAttachments", () => {
  it("attaches nothing without a project or a mention", async () => {
    const tree = [{ path: "main.tex", is_dir: false }];

    expect(await mentionAttachments(null, "see @main.tex", tree)).toEqual([]);
    expect(await mentionAttachments("paper", "see main.tex", tree)).toEqual([]);
    expect(readFileContent).not.toHaveBeenCalled();
  });

  it("attaches a mentioned file and caps a long one at 200 KB with a note", async () => {
    readFileContent.mockImplementation(async (_project: string, path: string) =>
      path === "big.tex" ? "x".repeat(200 * 1024 + 10) : "\\section{Intro}",
    );

    const attachments = await mentionAttachments("paper", "compare @intro.tex and @big.tex", [
      { path: "intro.tex", is_dir: false },
      { path: "big.tex", is_dir: false },
      { path: "  ", is_dir: false },
    ]);

    expect(attachments.map((attachment) => [attachment.id, attachment.name, attachment.mediaType])).toEqual([
      ["mention-file:intro.tex", "intro.tex", "text/plain"],
      ["mention-file:big.tex", "big.tex", "text/plain"],
    ]);
    expect(decoded(attachments[0].dataUrl)).toBe("\\section{Intro}");
    const big = decoded(attachments[1].dataUrl);
    expect(big.startsWith("x".repeat(200 * 1024))).toBe(true);
    expect(big.endsWith("[Only the first 200 KB of this file is shown. Use read_file with an offset for the rest.]")).toBe(true);
  });

  it("tells the agent to use read_file when a mentioned file cannot be read", async () => {
    readFileContent.mockRejectedValue(new Error("permission denied"));

    const [attachment] = await mentionAttachments("paper", "read @locked.tex", [{ path: "locked.tex", is_dir: false }]);

    expect(decoded(attachment.dataUrl)).toBe("[This file could not be read. Try read_file instead.]");
  });

  it("lists a mentioned folder, an empty folder, and caps a very large listing", async () => {
    const many = Array.from({ length: 402 }, (_, index) => ({ path: `data/f${String(index).padStart(3, "0")}.csv`, is_dir: false }));
    const tree = [
      { path: "sections", is_dir: true },
      { path: "sections/intro.tex", is_dir: false },
      { path: "sections/parts", is_dir: true },
      { path: "empty", is_dir: true },
      { path: "data", is_dir: true },
      ...many,
    ];

    const attachments = await mentionAttachments("paper", "look at @sections/ @empty/ @data/", tree);

    expect(attachments.map((attachment) => attachment.name)).toEqual([
      "sections/ (listing)",
      "empty/ (listing)",
      "data/ (listing)",
    ]);
    expect(decoded(attachments[0].dataUrl)).toBe("sections/intro.tex\nsections/parts/");
    expect(decoded(attachments[1].dataUrl)).toBe("This folder is empty.");
    const listing = decoded(attachments[2].dataUrl).split("\n");
    expect(listing).toHaveLength(401);
    expect(listing.at(-1)).toBe("[2 more entries not listed.]");
    expect(readFileContent).not.toHaveBeenCalled();
  });
});
