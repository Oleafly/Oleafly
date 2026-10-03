import { describe, expect, it } from "vitest";
import type { SubmissionProfileId } from "./profiles";
import { LARGE_IMAGE_BYTES, runTypstSubmissionRules, typstReferencedImages } from "./typst-submission-rules";
import type { PdfFacts, ProjectFile } from "./types";

const FRONT = '#show: tpl.with(abstract: [We study things.], keywords: ("a", "b"))\n';

function run(
  files: ProjectFile[],
  options: { profileId?: SubmissionProfileId; anonymousReview?: boolean; pdf?: PdfFacts } = {},
) {
  return runTypstSubmissionRules({
    project: { mainFile: "main.typ", files },
    profileId: options.profileId ?? "generic",
    anonymousReview: options.anonymousReview ?? false,
    ...(options.pdf ? { pdf: options.pdf } : {}),
  });
}

const ids = (files: ProjectFile[], options?: Parameters<typeof run>[1]) => run(files, options).map((finding) => finding.id);

describe("Typst venue templates", () => {
  it("asks for an IEEE-style template under the IEEE profile", () => {
    const [finding] = run([{ path: "main.typ", content: `${FRONT}= Intro` }], { profileId: "ieee" }).filter(
      (item) => item.id === "submission-document-class",
    );
    expect(finding.title).toEqual({ key: "rules.submission-document-class.titleTypst", params: { profile: "IEEE conference / journal" } });
    expect(finding.detail.key).toBe("rules.submission-document-class.detailNoTemplateTypst");
    expect(finding.severity).toBe("warning");
  });

  it("names the template the project imports instead", () => {
    const content = `#import "@preview/clean-acmart:0.0.1": acmart\n${FRONT}`;
    const [finding] = run([{ path: "main.typ", content }], { profileId: "ieee" }).filter(
      (item) => item.id === "submission-document-class",
    );
    expect(finding.detail).toEqual({
      key: "rules.submission-document-class.detailTypst",
      params: { expected: "charged-ieee or bamdone-ieeeconf or tatras-ieee", actual: "clean-acmart" },
    });
  });

  it("accepts a matching template and its index terms", () => {
    const content = '#import "@preview/charged-ieee:0.1.4": ieee\n#show: ieee.with(abstract: [Text], index-terms: ("a",))';
    expect(ids([{ path: "main.typ", content }], { profileId: "ieee" })).toEqual([]);
  });

  it("skips the template check for profiles without a Typst signal", () => {
    expect(ids([{ path: "main.typ", content: FRONT }], { profileId: "arxiv" })).not.toContain(
      "submission-document-class",
    );
  });
});

describe("Typst abstract and keywords", () => {
  it("asks for an abstract in Typst terms", () => {
    const finding = run([{ path: "main.typ", content: "= Intro" }]).find((item) => item.id === "submission-no-abstract");
    expect(finding?.detail.key).toBe("rules.submission-no-abstract.detailTypst");
  });

  it("accepts a language-specific abstract argument or an abstract page call", () => {
    expect(ids([{ path: "main.typ", content: "#show: thesis.with(abstract-en: [Text])" }])).not.toContain(
      "submission-no-abstract",
    );
    expect(ids([{ path: "main.typ", content: "#abstract-page[Text]" }])).not.toContain("submission-no-abstract");
  });

  it("accepts an Abstract heading", () => {
    expect(ids([{ path: "main.typ", content: "= Abstract\nText" }])).not.toContain("submission-no-abstract");
  });

  it("asks for keywords where the profile needs them", () => {
    const content = '#import "@preview/charged-ieee:0.1.4": ieee\n#show: ieee.with(abstract: [Text])';
    const finding = run([{ path: "main.typ", content }], { profileId: "ieee" }).find(
      (item) => item.id === "submission-no-keywords",
    );
    expect(finding?.detail.key).toBe("rules.submission-no-keywords.detailTypst");
  });

  it("accepts keywords given as an argument, a call or a heading", () => {
    const head = '#import "@preview/charged-ieee:0.1.4": ieee\n#show: ieee.with(abstract: [Text]';
    const keywords = (content: string) =>
      ids([{ path: "main.typ", content }], { profileId: "ieee" }).includes("submission-no-keywords");
    expect(keywords(`${head}, index-terms: ("a",))`)).toBe(false);
    expect(keywords(`${head}, keywords: none)`)).toBe(true);
    expect(keywords(`${head}, keywords: ( ))`)).toBe(true);
    expect(keywords(`${head})\n#ieee-keywords("a")`)).toBe(false);
    expect(keywords(`${head})\n= Index Terms\nA`)).toBe(false);
  });
});

describe("Typst project paths", () => {
  it("reports a path whose case does not match and a missing file", () => {
    const files = [
      { path: "main.typ", content: `${FRONT}#image("Figures/Plot.png", alt: "x")\n#include "gone.typ"` },
      { path: "figures/plot.png" },
    ];
    expect(ids(files)).toEqual(["submission-path-case", "submission-missing-project-file"]);
  });

  it("leaves package imports and root paths alone", () => {
    const files = [
      { path: "main.typ", content: `${FRONT}#import "@preview/cetz:0.3.0": canvas\n#image("/figures/plot.png", alt: "x")` },
      { path: "figures/plot.png" },
    ];
    expect(ids(files)).toEqual([]);
  });

  it("flags non-portable file names under the arXiv profile", () => {
    expect(ids([{ path: "main.typ", content: FRONT }, { path: "my figure.png" }], { profileId: "arxiv" })).toContain(
      "submission-nonportable-filename",
    );
  });
});

describe("Typst figures and placeholders", () => {
  it("asks for a caption on figures and tables", () => {
    const content = `${FRONT}#figure(image("a.png", alt: "x"))\n#figure(table(columns: 2, [a], [b]))\n#figure(image("a.png", alt: "x"), caption: [Done])`;
    const findings = run([{ path: "main.typ", content }, { path: "a.png" }]).filter(
      (item) => item.id === "submission-missing-caption",
    );
    expect(findings.map((item) => item.title.key)).toEqual([
      "rules.submission-missing-caption.titleFigure",
      "rules.submission-missing-caption.titleTable",
    ]);
  });

  it("flags lorem placeholder text", () => {
    const finding = run([{ path: "main.typ", content: `${FRONT}#lorem(40)` }]).find(
      (item) => item.id === "submission-placeholder",
    );
    expect(finding?.detail.key).toBe("rules.submission-placeholder.detailTypst");
  });
});

describe("Typst very large images", () => {
  const files = (size: number): ProjectFile[] => [
    { path: "main.typ", content: `${FRONT}#image("photo.jpg", alt: "x")` },
    { path: "photo.jpg", size },
    { path: "unused.png", size: LARGE_IMAGE_BYTES * 3 },
  ];

  it("flags a referenced image over the limit and ignores unused files", () => {
    const findings = run(files(LARGE_IMAGE_BYTES + 1)).filter((item) => item.id === "submission-large-image");
    expect(findings).toHaveLength(1);
    expect(findings[0].title.params).toEqual({ file: "photo.jpg" });
    expect(findings[0].detail.params).toEqual({ limit: "5 MB" });
  });

  it("accepts an image under the limit", () => {
    expect(ids(files(LARGE_IMAGE_BYTES))).not.toContain("submission-large-image");
  });

  it("lists the images the sources reference", () => {
    expect(
      typstReferencedImages({
        mainFile: "main.typ",
        files: [
          { path: "main.typ", content: '#image("Photo.JPG")\n#include "ch/a.typ"' },
          { path: "ch/a.typ", content: '#image("../photo.jpg")\n#image("gone.png")' },
          { path: "photo.jpg" },
        ],
      }),
    ).toEqual(["photo.jpg"]);
  });
});

describe("Typst privacy", () => {
  it("flags an internal note in a Typst comment", () => {
    const findings = run([{ path: "main.typ", content: `${FRONT}// TODO: ask Bob before release\nText` }]);
    expect(findings.map((item) => item.id)).toContain("privacy-internal-comment");
  });

  it("does not treat a percent sign in Typst as a comment", () => {
    expect(ids([{ path: "main.typ", content: `${FRONT}Growth was 5% TODO-free.` }])).not.toContain(
      "privacy-internal-comment",
    );
  });

  it("keeps the shared credential and sensitive file checks", () => {
    expect(
      ids([{ path: "main.typ", content: `${FRONT}#let key = "sk-proj-abcdefghijklmnopqrstuvwx"` }, { path: ".env" }]),
    ).toEqual(expect.arrayContaining(["privacy-credential", "privacy-sensitive-file"]));
  });

  it("finds identity leaks during anonymous review only", () => {
    const content =
      '#show: ieee.with(abstract: [x], keywords: ("a",), authors: ((name: "Jane Doe", email: "jane@uni.edu"),))\n= Acknowledgments\nThanks.';
    const anonymous = run([{ path: "main.typ", content }], { anonymousReview: true }).map((item) => item.id);
    expect(anonymous).toEqual(
      expect.arrayContaining(["privacy-blind-author", "privacy-blind-email", "privacy-blind-acknowledgements"]),
    );
    const open = ids([{ path: "main.typ", content }]);
    expect(open).not.toContain("privacy-blind-author");
    expect(open).not.toContain("privacy-blind-email");
  });

  it("finds authors passed to a function imported from a template package", () => {
    const content = '#import "@preview/approximate-acmsmall:0.2.0": acmart\n#let paper = acmart(abstract: [x], keywords: ("a",), authors: ((name: "Jane Doe"),))';
    expect(ids([{ path: "main.typ", content }], { anonymousReview: true })).toContain("privacy-blind-author");
  });

  it("accepts anonymous author placeholders", () => {
    const content = '#show: ieee.with(abstract: [x], authors: ((name: "Anonymous"),))';
    expect(ids([{ path: "main.typ", content }], { anonymousReview: true })).not.toContain("privacy-blind-author");
  });

  it("points the email finding at the address", () => {
    const content = `${FRONT}Contact: jane@uni.edu`;
    const finding = run([{ path: "main.typ", content }], { anonymousReview: true }).find(
      (item) => item.id === "privacy-blind-email",
    );
    expect(finding && content.slice(finding.from, finding.to)).toBe("jane@uni.edu");
    expect(finding?.file).toBe("main.typ");
  });

  it("spans the first full address and stops at the last letter-only top-level domain", () => {
    const email = (text: string) => {
      const content = `${FRONT}${text}`;
      const finding = run([{ path: "main.typ", content }], { anonymousReview: true }).find(
        (item) => item.id === "privacy-blind-email",
      );
      return finding ? content.slice(finding.from, finding.to) : null;
    };
    expect(email("x@@jane.doe+tag@mail.uni.edu.2 and bob@lab.org")).toBe("jane.doe+tag@mail.uni.edu");
    expect(email("first@host.c then j_d%1@a-b.co2")).toBe("j_d%1@a-b.co");
    expect(email("no@tld.x and @alone.com")).toBeNull();
    expect(email(`${"a".repeat(20000)}@ ${"b.".repeat(20000)}`)).toBeNull();
  });

  it("reads the PDF author during anonymous review", () => {
    const pdf = { author: "Jane Doe", fonts: [], pages: [], pageCount: 1 } as unknown as PdfFacts;
    expect(ids([{ path: "main.typ", content: FRONT }], { anonymousReview: true, pdf })).toContain("privacy-pdf-author");
  });
});

describe("Typst PDF checks", () => {
  it("keeps the profile's PDF rules", () => {
    const pdf = {
      version: "1.7",
      outlineCount: 2,
      linkCount: 0,
      attachmentCount: 0,
      restricted: false,
      fonts: [],
    } as unknown as PdfFacts;
    const content = '#import "@preview/charged-ieee:0.1.4": ieee\n#show: ieee.with(abstract: [x], index-terms: ("a",))';
    expect(ids([{ path: "main.typ", content }], { profileId: "ieee", pdf })).toEqual(["submission-bookmarks"]);
  });
});
