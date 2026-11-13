import { describe, expect, it } from "vitest";
import { BlockFileTooLargeError } from "./note-blocks";
import {
  moleculeData,
  moleculeText,
  parseMoleculeSource,
  repairMolHeader,
  resolveMoleculeFormat,
  sniffMoleculeFormat,
  withMoleculeOption,
} from "./molecule-source";

const XYZ = "3\nwater\nO 0 0 0.1173\nH 0 0.7572 -0.4692\nH 0 -0.7572 -0.4692";
const MOL = "\n  RDKit          3D\n\n  2  1  0  0  0  0  0  0  0  0999 V2000\n    0.0000    0.0000    0.0000 C   0  0\n    1.2000    0.0000    0.0000 O   0  0\n  1  2  1  0\nM  END";

function textUrl(text: string): string {
  return `data:chemical/x-xyz;base64,${btoa(text)}`;
}

describe("parseMoleculeSource", () => {
  it("reads options before the inline data", () => {
    expect(parseMoleculeSource(`format: XYZ\nstyle: Sphere\ncolour: chain\n${XYZ}`)).toEqual({
      ok: true,
      spec: { path: null, format: "xyz", style: "sphere", color: "chain", data: XYZ },
    });
    expect(parseMoleculeSource("format: mmcif\ncolor: ss\ndata_x\nloop_")).toMatchObject({
      ok: true,
      spec: { format: "cif", color: "ss", style: null },
    });
  });

  it("reads a file path and ignores inline text with it", () => {
    expect(parseMoleculeSource("path: ./assets/1abc.pdb\nATOM  1")).toEqual({
      ok: true,
      spec: { path: "assets/1abc.pdb", format: null, style: null, color: null, data: "" },
    });
  });

  it.each([
    ["format: png\nx", "format", "png"],
    ["style: ribbon\nx", "style", "ribbon"],
    ["color: rainbow\nx", "color", "rainbow"],
    ["path: ../x.pdb", "path", "../x.pdb"],
    ["style: stick\n\n", "empty", ""],
  ])("reports %j", (source, problem, value) => {
    expect(parseMoleculeSource(source)).toEqual({ ok: false, problem, value });
  });
});

describe("withMoleculeOption", () => {
  it("rewrites an existing option line and keeps how it was written", () => {
    expect(withMoleculeOption("format: xyz\nStyle:  stick\n3\n", "style", "sphere")).toBe("format: xyz\nStyle: sphere\n3\n");
    expect(withMoleculeOption("colour: chain\nATOM  1", "color", "residue")).toBe("colour: residue\nATOM  1");
  });

  it("adds the option after the others, or first when there are none", () => {
    expect(withMoleculeOption("path: assets/a.pdb", "style", "line")).toBe("path: assets/a.pdb\nstyle: line");
    expect(withMoleculeOption("\nformat: xyz\n3\n\nC 0 0 0", "color", "chain")).toBe("\nformat: xyz\ncolor: chain\n3\n\nC 0 0 0");
    expect(withMoleculeOption("3\nstyle: stick\nC 0 0 0", "style", "line")).toBe("style: line\n3\nstyle: stick\nC 0 0 0");
  });

  it("rewrites an option line that ends in a lone carriage return", () => {
    expect(withMoleculeOption("style: stick\r", "style", "line")).toBe("style: line");
  });

  it("writes a source that parses to the chosen style and color", () => {
    const source = withMoleculeOption(withMoleculeOption(XYZ, "style", "sphere"), "color", "chain");
    expect(parseMoleculeSource(source)).toMatchObject({ ok: true, spec: { style: "sphere", color: "chain" } });
  });
});

describe("formats", () => {
  it.each([
    ["@<TRIPOS>MOLECULE\nwater", "mol2"],
    ["data_1ABC\nloop_\n_atom_site.id", "cif"],
    ["data_x\n_atom_site.id 1", "cif"],
    ["HEADER    PROTEIN\nATOM      1  N   MET A   1", "pdb"],
    ["HETATM    1  O   HOH A   1", "pdb"],
    [MOL, "sdf"],
    ["x\n$$$$\n", "sdf"],
    [XYZ, "xyz"],
    ["\n\n 2\n\nC 1.0 -2e-1 .5\n", "xyz"],
    ["3\nwater\nnot an atom line", null],
    ["3\nwater", null],
    ["hello", null],
    ["", null],
  ])("sniffs %j as %s", (text, format) => {
    expect(sniffMoleculeFormat(text)).toBe(format);
  });

  it("prefers the option, then the fence, then the extension, then the data", () => {
    const spec = { path: null, format: null, style: null, color: null, data: "" };
    expect(resolveMoleculeFormat({ ...spec, format: "pdb" }, "xyz", XYZ)).toBe("pdb");
    expect(resolveMoleculeFormat(spec, "mol2", XYZ)).toBe("mol2");
    expect(resolveMoleculeFormat({ ...spec, path: "a/b.ENT" }, "molecule", XYZ)).toBe("pdb");
    expect(resolveMoleculeFormat({ ...spec, path: "a/b.sd" }, undefined, XYZ)).toBe("sdf");
    expect(resolveMoleculeFormat({ ...spec, path: "a/b.txt" }, undefined, XYZ)).toBe("xyz");
    expect(resolveMoleculeFormat({ ...spec, path: "a/noext" }, undefined, "?")).toBeNull();
    expect(resolveMoleculeFormat(spec, undefined, XYZ)).toBe("xyz");
  });

  it("restores the three header lines of a MOL file", () => {
    const stripped = MOL.split("\n").slice(1).join("\n");
    expect(repairMolHeader(stripped).split("\n")[3]).toContain("V2000");
    expect(repairMolHeader(MOL)).toBe(MOL);
    expect(repairMolHeader("  2  1  0  0  0  0  0  0  0  0999 V3000")).toBe("\n\n\n  2  1  0  0  0  0  0  0  0  0999 V3000");
    expect(repairMolHeader("no counts line")).toBe("no counts line");
    expect(moleculeData("  1  0 V2000", "mol")).toBe("\n\n\n  1  0 V2000");
    expect(moleculeData("  1  0 V2000", "sdf")).toBe("\n\n\n  1  0 V2000");
    expect(moleculeData("  1  0 V2000", "xyz")).toBe("  1  0 V2000");
  });
});

describe("moleculeText", () => {
  const spec = { path: "a.xyz", format: null, style: null, color: null, data: "" };

  it("returns inline data or reads the file", async () => {
    expect(await moleculeText({ ...spec, path: null, data: XYZ }, undefined)).toBe(XYZ);
    expect(await moleculeText(spec, () => Promise.resolve(textUrl(XYZ)))).toBe(XYZ);
  });

  it("reports missing, unreadable and large files", async () => {
    await expect(moleculeText(spec, () => Promise.resolve(null))).rejects.toMatchObject({ problem: "missing" });
    await expect(moleculeText(spec, undefined)).rejects.toMatchObject({ problem: "missing" });
    await expect(moleculeText(spec, () => Promise.resolve("plain"))).rejects.toMatchObject({ problem: "unreadable" });
    await expect(moleculeText(spec, () => Promise.resolve(`data:x;base64,${"A".repeat(9 * 1024 * 1024)}`))).rejects.toBeInstanceOf(
      BlockFileTooLargeError,
    );
  });
});
