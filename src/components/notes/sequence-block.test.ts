// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { loadNamespace } from "@/i18n";
import {
  BLOCK_LENGTH,
  detectKind,
  gcContent,
  LINE_LENGTH,
  paintSequence,
  parseSequences,
  RECORD_COUNT_LIMIT,
  RECORD_LIMIT,
  residueTone,
  reverseComplement,
  SEQUENCE_TEMPLATE,
  sequenceBlock,
  TOTAL_LIMIT,
  translate,
  translationTrack,
} from "./sequence-block";

beforeAll(async () => {
  await loadNamespace("notes");
});

function paint(source: string, still = false): HTMLElement {
  const preview = document.createElement("div");
  paintSequence(preview, source, { still });
  return preview;
}

function bases(preview: HTMLElement): string {
  return [...preview.querySelectorAll(".note-seq-bases")].map((node) => node.textContent).join("");
}

function button(preview: HTMLElement, name: string): HTMLButtonElement {
  const found = [...preview.querySelectorAll("button")].find((node) => node.textContent === name);
  if (!found) throw new Error(`no ${name} button`);
  return found;
}

describe("sequence parsing", () => {
  it("reads FASTA records with wrapped residues and ignores spaces, digits and comments", () => {
    const parsed = parseSequences(
      [">seq1 first one", "ACGT ACGT", "  1 acgu", ";old comment", ">seq2", "MKV*", ">empty", ""].join("\r\n"),
    );
    expect(parsed).toEqual({
      ok: true,
      records: [
        { header: "seq1 first one", residues: "ACGTACGTacgu", kind: "protein" },
        { header: "seq2", residues: "MKV*", kind: "protein" },
        { header: "empty", residues: "", kind: "dna" },
      ],
    });
  });

  it("reads a raw sequence and residues before the first header", () => {
    expect(parseSequences("acgt\nacgt")).toEqual({
      ok: true,
      records: [{ header: "", residues: "acgtacgt", kind: "dna" }],
    });
    const parsed = parseSequences("ACGU\n>next\nAAA");
    expect(parsed.ok && parsed.records.map((record) => [record.header, record.kind])).toEqual([
      ["", "rna"],
      ["next", "dna"],
    ]);
  });

  it("names the first character that is not a residue", () => {
    expect(parseSequences(">a\nACGT\nAC@T")).toEqual({
      ok: false,
      problem: "character",
      character: "@",
      line: 3,
      column: 3,
    });
    expect(parseSequences("ACé")).toMatchObject({ character: "é", column: 3 });
    expect(parseSequences("🧬")).toMatchObject({ character: "🧬", column: 1 });
  });

  it("says when there is nothing to read", () => {
    expect(parseSequences("")).toEqual({ ok: false, problem: "empty" });
    expect(parseSequences("  \n12 34\n;note")).toEqual({ ok: false, problem: "empty" });
  });

  it.each([
    ["ACGTN", "dna"],
    ["acgtacgtacR", "dna"],
    ["acgtnnnnRY", "protein"],
    ["ACG-T.A", "dna"],
    ["ACGU", "rna"],
    ["", "dna"],
    ["MKVLAAGIIG", "protein"],
    ["MAD", "protein"],
    ["ACGT*", "protein"],
    ["ACGTU", "protein"],
    ["ACGTQ", "protein"],
  ])("detects %s as %s", (residues, kind) => {
    expect(detectKind(residues)).toBe(kind);
  });
});

describe("sequence tools", () => {
  it("reverse complements DNA, RNA and ambiguity codes and keeps case and gaps", () => {
    expect(reverseComplement("ATGCatgc")).toBe("gcatGCAT");
    expect(reverseComplement("AUGC")).toBe("GCAU");
    expect(reverseComplement("RYSWKMBDHVN-.")).toBe(".-NBDHVKMWSRY");
    expect(reverseComplement("AXT")).toBe("AXT");
    expect(reverseComplement("")).toBe("");
  });

  it("translates frame 1 with the standard code", () => {
    expect(translate("ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG")).toBe("MAIVMGR*KGAR*");
    expect(translate("AUGUUUUAA")).toBe("MF*");
    expect(translate("atg-gc.c")).toBe("MA");
    expect(translate("ATGGC")).toBe("M");
    expect(translate("GCNTTRCAY")).toBe("ALH");
    expect(translate("NNNATZ")).toBe("XX");
  });

  it("lines the translation up under the middle base of each codon", () => {
    expect(translationTrack("ATGGCC")).toBe(" M  A ");
    expect(translationTrack("AT-GGCCA")).toBe(" M   A  ");
  });

  it("measures GC content over unambiguous bases", () => {
    expect(gcContent("GGCCAATT")).toBe(0.5);
    expect(gcContent("ggsw")).toBe(0.75);
    expect(gcContent("ACGU")).toBe(0.5);
    expect(gcContent("NNNN")).toBeNull();
  });

  it("colours bases and amino acid classes", () => {
    expect(residueTone("dna", "a")).toContain("emerald");
    expect(residueTone("rna", "U")).toContain("red");
    expect(residueTone("dna", "N")).toBe("text-muted-foreground");
    expect(residueTone("protein", "K")).toContain("violet");
    expect(residueTone("protein", "X")).toBe("text-muted-foreground");
  });
});

describe("sequence drawing", () => {
  it("draws the header, kind, length, GC content and residues in ruled blocks", () => {
    const residues = "ACGT".repeat(20);
    const preview = paint(`>gene one\n${residues}`);
    expect(preview.querySelector(".note-seq-header")?.textContent).toBe("gene one");
    expect(preview.querySelector(".note-seq-meta")?.textContent).toBe("DNA · 80 bp · GC 50%");
    expect([...preview.querySelectorAll(".note-seq-position")].map((node) => node.textContent)).toEqual(["1", "61"]);
    expect(preview.querySelectorAll(".note-seq-line")).toHaveLength(2);
    expect(preview.querySelectorAll(".note-seq-block")).toHaveLength(Math.ceil(80 / BLOCK_LENGTH));
    expect(bases(preview)).toBe(residues);
    expect(preview.querySelector(".note-seq-residues")?.getAttribute("aria-label")).toBe("Residues of gene one");
    const first = preview.querySelector(".note-seq-bases span") as HTMLElement;
    expect(first.textContent).toBe("A");
    expect(first.className).toContain("emerald");
    expect(preview.querySelector(".note-seq-legend")).toBeNull();
    expect(LINE_LENGTH).toBe(60);
  });

  it("groups runs of the same colour into one span", () => {
    const preview = paint("AAAACCC");
    expect([...preview.querySelectorAll(".note-seq-bases span")].map((node) => node.textContent)).toEqual([
      "AAAA",
      "CCC",
    ]);
  });

  it("shows RNA and protein records with their own units and a protein legend", () => {
    const preview = paint(">r\nAUGC\n>p\nMKDE");
    expect([...preview.querySelectorAll(".note-seq-meta")].map((node) => node.textContent)).toEqual([
      "RNA · 4 nt · GC 50%",
      "Protein · 4 aa",
    ]);
    expect([...preview.querySelectorAll(".note-seq-legend li")].map((node) => node.textContent)).toEqual([
      "AVLIMFWHydrophobic",
      "STNQYCPolar",
      "KRHPositive",
      "DENegative",
      "GPGlycine and proline",
    ]);
  });

  it("leaves GC content out when no base is unambiguous", () => {
    expect(paint("NNNN").querySelector(".note-seq-meta")?.textContent).toBe("DNA · 4 bp");
  });

  it("names untitled and empty records", () => {
    const preview = paint(">\n>named");
    expect([...preview.querySelectorAll(".note-seq-header")].map((node) => node.textContent)).toEqual([
      "Untitled sequence",
      "named",
    ]);
    expect(preview.querySelector(".note-seq-meta")?.textContent).toBe("No residues");
    expect(preview.querySelector(".note-seq-residues")).toBeNull();
    expect(preview.querySelector(".note-seq-tools")).toBeNull();
  });

  it("switches nucleotide records to the reverse complement and back", () => {
    const preview = paint(">dna\nAACG\n>protein\nMKV");
    const reverse = button(preview, "Reverse complement");
    expect(reverse.getAttribute("aria-pressed")).toBe("false");
    reverse.click();
    expect(reverse.getAttribute("aria-pressed")).toBe("true");
    expect(bases(preview)).toBe("CGTTMKV");
    reverse.click();
    expect(reverse.getAttribute("aria-pressed")).toBe("false");
    expect(bases(preview)).toBe("AACGMKV");
  });

  it("shows the translation under DNA and translates the reverse strand when both are on", () => {
    const preview = paint(">dna\nATGGCCTAA\n>protein\nMKV");
    button(preview, "Translation").click();
    const tracks = [...preview.querySelectorAll(".note-seq-translation")].map((node) => node.textContent);
    expect(tracks).toEqual([" M  A  * "]);
    button(preview, "Reverse complement").click();
    expect(bases(preview).startsWith("TTAGGCCAT")).toBe(true);
    expect(preview.querySelector(".note-seq-translation")?.textContent).toBe(" L  G  H ");
    button(preview, "Translation").click();
    expect(preview.querySelector(".note-seq-translation")).toBeNull();
  });

  it("keeps the toggles across repaints of the same block", () => {
    const preview = document.createElement("div");
    paintSequence(preview, "ATGGCC", { still: false });
    button(preview, "Translation").click();
    paintSequence(preview, "ATGGCCAAA", { still: false });
    expect(button(preview, "Translation").getAttribute("aria-pressed")).toBe("true");
    expect(button(preview, "Reverse complement").getAttribute("aria-pressed")).toBe("false");
    expect(preview.querySelector(".note-seq-translation")?.textContent).toBe(" M  A  K ");
    paintSequence(preview, "ATGGCC", { still: true });
    expect(preview.querySelector(".note-seq-translation")).toBeNull();
  });

  it("draws the start of a long record and the end of its reverse complement", () => {
    const preview = paint(`>long\n${"A".repeat(RECORD_LIMIT)}${"C".repeat(5)}`);
    expect(bases(preview)).toHaveLength(RECORD_LIMIT);
    expect(preview.querySelector(".note-seq-hidden")?.textContent).toBe("5 more residues not shown");
    button(preview, "Reverse complement").click();
    expect(bases(preview).startsWith("GGGGG")).toBe(true);
    expect(bases(preview)).toHaveLength(RECORD_LIMIT);
  });

  it("shares a residue budget across records and caps how many records are drawn", () => {
    const record = "ACGT".repeat(RECORD_LIMIT / 4);
    const source = Array.from({ length: 4 }, (_value, index) => `>r${index}\n${record}`).join("\n");
    const preview = paint(source);
    expect(bases(preview)).toHaveLength(TOTAL_LIMIT);
    expect([...preview.querySelectorAll(".note-seq-hidden")].map((node) => node.textContent)).toEqual([
      "10,000 more residues not shown",
    ]);
    const many = Array.from({ length: RECORD_COUNT_LIMIT + 1 }, (_value, index) => `>r${index}\nA`).join("\n");
    const listed = paint(many);
    expect(listed.querySelectorAll(".note-seq-record")).toHaveLength(RECORD_COUNT_LIMIT);
    expect(listed.querySelector(".note-seq-more")?.textContent).toBe("1 more record not shown");
    expect(paint(`${many}\n>extra\nA`).querySelector(".note-seq-more")?.textContent).toBe("2 more records not shown");
    expect(paint(">a\nAC\n>b\nAAA", true).querySelector(".note-seq-hidden")).toBeNull();
  });

  it("draws a short still preview without controls", () => {
    const preview = paint(`>a\n${"A".repeat(300)}\n>b\nC\n>c\nG\n>d\nT`, true);
    expect(preview.querySelector("button")).toBeNull();
    expect(preview.querySelectorAll(".note-seq-record")).toHaveLength(3);
    expect(preview.querySelector(".note-seq-hidden")?.textContent).toBe("60 more residues not shown");
    expect(preview.querySelector(".note-seq-more")?.textContent).toBe("1 more record not shown");
  });

  it("says when the source is empty or has a character that is not a residue", () => {
    expect(paint("").textContent).toBe("Paste a FASTA record or a raw sequence.");
    expect(paint(">x\nAC!G").textContent).toBe('Line 2, column 3: "!" isn\'t a residue.');
    expect(paint(">x\nAC!G").querySelector(".note-drawn-empty")).not.toBeNull();
  });

  it("describes itself as an interactive note block for sequence and fasta fences", () => {
    expect(sequenceBlock.name).toBe("sequence");
    expect(sequenceBlock.aliases).toEqual(["fasta"]);
    expect(sequenceBlock.label()).toBe("Sequence");
    expect(sequenceBlock.interactive).toBe(true);
    expect(sequenceBlock.template?.()).toEqual({ info: "sequence", source: SEQUENCE_TEMPLATE });
    const preview = document.createElement("div");
    expect(sequenceBlock.paint(preview, SEQUENCE_TEMPLATE, { still: false })).toBeUndefined();
    expect(preview.querySelector(".note-seq-meta")?.textContent).toBe("DNA · 39 bp · GC 56.4%");
    expect(paint(SEQUENCE_TEMPLATE, false).querySelectorAll("button")).toHaveLength(2);
    const bare = document.createElement("div");
    paintSequence(bare, "ACGT");
    expect(bare.querySelectorAll("button")).toHaveLength(2);
  });
});
