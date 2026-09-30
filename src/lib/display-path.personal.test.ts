import { afterEach, describe, expect, it } from "vitest";
import {
  personalParts,
  resetDisplayHomes,
  setDisplayHomes,
} from "@/lib/display-path";

afterEach(() => resetDisplayHomes());

function marked(text: string, values?: readonly string[]): string[] {
  return personalParts(text, values)
    .filter((part) => part.personal)
    .map((part) => part.text);
}

describe("personalParts", () => {
  it("returns the text as one plain part when nothing is personal", () => {
    expect(personalParts("Compiled in 2 s")).toEqual([{ text: "Compiled in 2 s", personal: false }]);
    expect(personalParts("")).toEqual([]);
  });

  it("marks home paths and absolute paths, and keeps the text around them", () => {
    const parts = personalParts("Wrote ~/paper/main.pdf and /opt/tex/bin/latexmk.");
    expect(parts.map((part) => part.text).join("")).toBe(
      "Wrote ~/paper/main.pdf and /opt/tex/bin/latexmk.",
    );
    expect(marked("Wrote ~/paper/main.pdf and /opt/tex/bin/latexmk.")).toEqual([
      "~/paper/main.pdf",
      "/opt/tex/bin/latexmk",
    ]);
    expect(marked("(/usr/local/texlive/article.cls)")).toEqual(["/usr/local/texlive/article.cls"]);
    expect(marked("home is ~")).toEqual(["~"]);
  });

  it("marks Windows drive, UNC and verbatim paths", () => {
    expect(marked(String.raw`at C:\Users\Ada\paper\main.tex`)).toEqual([
      String.raw`C:\Users\Ada\paper\main.tex`,
    ]);
    expect(marked("at D:/texlive/bin")).toEqual(["D:/texlive/bin"]);
    expect(marked(String.raw`share \\server\papers\draft`)).toEqual([String.raw`\\server\papers\draft`]);
  });

  it("leaves URLs, fractions, slash commands and LaTeX ties alone", () => {
    expect(marked("See https://example.com/a/b")).toEqual([]);
    expect(marked("Use 1/2 or and/or")).toEqual([]);
    expect(marked("Type /compact to shrink")).toEqual([]);
    expect(marked(String.raw`Fig.~\ref{a}`)).toEqual([]);
  });

  it("marks the account name from the home folder as a whole word", () => {
    setDisplayHomes(["/Users/ada"]);
    expect(marked("Signed in as ada on this Mac")).toEqual(["ada"]);
    expect(marked("adamant and Ada stay")).toEqual([]);
  });

  it("ignores case for a Windows account name", () => {
    setDisplayHomes([String.raw`C:\Users\Ada`]);
    expect(marked("user ada")).toEqual(["ada"]);
  });

  it("marks email addresses, such as a commit author's", () => {
    expect(marked("Author: Ada Lovelace <ada.l+git@example.co.uk>")).toEqual(["ada.l+git@example.co.uk"]);
    expect(marked("Use @mentions or user@host")).toEqual([]);
  });

  it("marks the extra values it is given", () => {
    expect(marked("Uses 1.2 GB in total", ["1.2 GB"])).toEqual(["1.2 GB"]);
    expect(marked("12 projects", ["2"])).toEqual([]);
  });
});
