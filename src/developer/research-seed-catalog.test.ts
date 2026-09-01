import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RESEARCH_SEED_PROJECTS,
  type ResearchSeedProject,
} from "@/developer/research-seed-catalog";
import {
  researchSeedArchiveName,
  researchSeedRoot,
} from "@/developer/seed-research-projects";
import { BOOK_COLOR_OPTIONS } from "@/components/library/Book";

const repositoryRoot = resolve(__dirname, "..", "..");
const fixtureRoot = join(repositoryRoot, "fixtures", "research-seeds");

function fixtureDir(project: ResearchSeedProject): string {
  return join(fixtureRoot, project.slug);
}

function fixtureFiles(dir: string, base = dir, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") continue;
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) fixtureFiles(absolute, base, found);
    else found.push(absolute.slice(base.length + 1));
  }
  return found;
}

describe("research seed catalog", () => {
  it("targets only the engines Oleafly bundles a compiler for", () => {
    // latexmk and Pandoc need a system toolchain the app does not ship, so a
    // fixture using them could never be guaranteed to compile.
    expect(new Set(RESEARCH_SEED_PROJECTS.map((project) => project.engine))).toEqual(
      new Set(["xetex", "typst"]),
    );
  });

  it("keeps a broad corpus across both engines and every project kind", () => {
    expect(RESEARCH_SEED_PROJECTS.length).toBeGreaterThanOrEqual(24);
    expect(
      RESEARCH_SEED_PROJECTS.filter((project) => project.engine === "xetex").length,
    ).toBeGreaterThanOrEqual(10);
    expect(
      RESEARCH_SEED_PROJECTS.filter((project) => project.engine === "typst").length,
    ).toBeGreaterThanOrEqual(10);
    expect(new Set(RESEARCH_SEED_PROJECTS.map((project) => project.kind))).toEqual(
      new Set(["document", "image", "diagram"]),
    );
  });

  it("covers every declared research-asset characteristic", () => {
    const actual = new Set(RESEARCH_SEED_PROJECTS.flatMap((project) => project.figureTypes));
    expect(actual).toEqual(
      new Set([
        "algorithm",
        "bibliography",
        "cjk",
        "diagram",
        "equations",
        "listing",
        "plot",
        "presentation",
        "table",
      ]),
    );
  });

  it("gives every project a unique slug, name, and non-empty summary", () => {
    const slugs = RESEARCH_SEED_PROJECTS.map((project) => project.slug);
    const names = RESEARCH_SEED_PROJECTS.map((project) => project.name);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(names).size).toBe(names.length);
    for (const project of RESEARCH_SEED_PROJECTS) {
      expect(project.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(project.summary.trim().length).toBeGreaterThan(20);
      expect(project.figureTypes.length).toBeGreaterThan(0);
      expect(new Set(project.figureTypes).size).toBe(project.figureTypes.length);
    }
  });

  it("spreads library cover colors across the whole palette", () => {
    const palette = BOOK_COLOR_OPTIONS.map((option) => option.hex);
    const used = RESEARCH_SEED_PROJECTS.map((project) => project.color);
    for (const color of used) expect(palette).toContain(color);

    // Every palette entry earns a place, and no color is over-used relative to
    // another, so a seeded library reads as a varied shelf rather than a wall
    // of default blue.
    expect(new Set(used)).toEqual(new Set(palette));
    const counts = palette.map((hex) => used.filter((color) => color === hex).length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it("ships a fixture directory containing the declared main document", () => {
    for (const project of RESEARCH_SEED_PROJECTS) {
      const dir = fixtureDir(project);
      expect(existsSync(dir), `${project.slug}: missing fixture directory`).toBe(true);
      expect(statSync(dir).isDirectory()).toBe(true);
      expect(
        existsSync(join(dir, project.mainDoc)),
        `${project.slug}: missing ${project.mainDoc}`,
      ).toBe(true);
      const expectedExtension = project.engine === "typst" ? ".typ" : ".tex";
      expect(project.mainDoc.endsWith(expectedExtension)).toBe(true);
    }
  });

  it("never carries generated output or an authored project manifest", () => {
    for (const project of RESEARCH_SEED_PROJECTS) {
      const files = fixtureFiles(fixtureDir(project));
      // The archive builder writes project.json itself, and a checked-in PDF or
      // build directory would be stale the moment a fixture changes.
      expect(files, `${project.slug}`).not.toContain("project.json");
      for (const file of files) {
        expect(file.endsWith(".pdf"), `${project.slug}: ${file}`).toBe(false);
        expect(file.startsWith(".oleafly/"), `${project.slug}: ${file}`).toBe(false);
      }
    }
  });

  it("declares a bibliography only when the fixture really has one", () => {
    for (const project of RESEARCH_SEED_PROJECTS) {
      if (!project.figureTypes.includes("bibliography")) continue;
      const files = fixtureFiles(fixtureDir(project));
      expect(
        files.some((file) => file.endsWith(".bib")),
        `${project.slug} declares a bibliography but ships no .bib file`,
      ).toBe(true);
    }
  });

  it("keeps Typst fixtures free of remote package imports", () => {
    for (const project of RESEARCH_SEED_PROJECTS) {
      if (project.engine !== "typst") continue;
      for (const file of fixtureFiles(fixtureDir(project))) {
        if (!file.endsWith(".typ")) continue;
        const source = readFileSync(join(fixtureDir(project), file), "utf8");
        // A withdrawn package version broke the previous corpus. Built-in
        // features only means a fixture cannot rot or need the network.
        expect(source, `${project.slug}/${file} imports a remote package`).not.toMatch(
          /@preview\//,
        );
      }
    }
  });

  it("keeps LaTeX fixtures off shell escape", () => {
    for (const project of RESEARCH_SEED_PROJECTS) {
      if (project.engine !== "xetex") continue;
      for (const file of fixtureFiles(fixtureDir(project))) {
        if (!file.endsWith(".tex")) continue;
        const source = readFileSync(join(fixtureDir(project), file), "utf8");
        expect(source, `${project.slug}/${file} uses \\write18`).not.toMatch(/\\write18/);
      }
    }
  });

  it("leaves no orphaned fixture directory behind", () => {
    const catalogued = new Set(RESEARCH_SEED_PROJECTS.map((project) => project.slug));
    const onDisk = readdirSync(fixtureRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    for (const slug of onDisk) {
      expect(catalogued.has(slug), `${slug} has no catalog entry`).toBe(true);
    }
  });
});

describe("local research seed cache", () => {
  it("derives the cache beside the desktop repository from the guarded dev library", () => {
    expect(researchSeedRoot("/Users/researcher/.oleafly-dev/projects/")).toBe(
      "/Users/researcher/Codespace/Oleafly/oleafly-seed",
    );
    expect(() => researchSeedRoot("/Users/researcher/.oleafly/projects")).toThrow(
      ".oleafly-dev sandbox",
    );
  });

  it("names each archive after its fixture slug", () => {
    expect(researchSeedArchiveName(RESEARCH_SEED_PROJECTS[0])).toBe(
      `${RESEARCH_SEED_PROJECTS[0].slug}.zip`,
    );
  });
});
