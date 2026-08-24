import { describe, expect, it } from "vitest";
import {
  RESEARCH_SEED_PROJECTS,
  type ResearchSeedFigure,
} from "@/developer/research-seed-catalog";
import {
  researchSeedArchiveName,
  researchSeedRoot,
} from "@/developer/seed-research-projects";

describe("development research seed catalog", () => {
  it("covers the requested real-world corpus breadth", () => {
    expect(RESEARCH_SEED_PROJECTS.length).toBeGreaterThanOrEqual(30);
    expect(RESEARCH_SEED_PROJECTS.filter((project) => project.engine === "typst")).toHaveLength(10);
    expect(RESEARCH_SEED_PROJECTS.filter((project) => project.engine === "markdown").length).toBeGreaterThanOrEqual(3);
    expect(RESEARCH_SEED_PROJECTS.filter((project) => project.kind === "image").length).toBeGreaterThanOrEqual(2);

    expect(new Set(RESEARCH_SEED_PROJECTS.map((project) => project.engine))).toEqual(
      new Set(["xetex", "latexmk", "typst", "markdown"]),
    );
    expect(new Set(RESEARCH_SEED_PROJECTS.map((project) => project.kind))).toEqual(
      new Set(["document", "image", "diagram"]),
    );
    expect(
      new Set(
        RESEARCH_SEED_PROJECTS
          .filter((project) => project.engine === "latexmk")
          .map((project) => project.flavor),
      ),
    ).toEqual(new Set(["pdflatex", "xelatex", "lualatex"]));
  });

  it("covers every declared research-asset characteristic", () => {
    const expected: ResearchSeedFigure[] = [
      "bibliography",
      "cjk",
      "diagram",
      "equations",
      "jpeg",
      "pdf",
      "plot",
      "png",
      "presentation",
      "svg",
      "table",
    ];
    const actual = new Set(RESEARCH_SEED_PROJECTS.flatMap((project) => project.figureTypes));
    expect(actual).toEqual(new Set(expected));
  });

  it("pins every source and includes its configured main document", () => {
    const names = new Set<string>();
    for (const project of RESEARCH_SEED_PROJECTS) {
      expect(project.repository).toMatch(/^[^/]+\/[^/]+$/);
      expect(project.revision).toMatch(/^[0-9a-f]{40}$/);
      expect(project.license.trim()).not.toBe("");
      expect(names.has(project.name)).toBe(false);
      names.add(project.name);

      const mainIsIncluded = project.include.some((entry) =>
        entry.endsWith("/") ? project.mainDoc.startsWith(entry) : entry === project.mainDoc,
      );
      expect(mainIsIncluded, `${project.name} must include ${project.mainDoc}`).toBe(true);
    }
  });

  it("keeps executable-document fixtures explicit", () => {
    expect(RESEARCH_SEED_PROJECTS.filter((project) => project.shellEscape).map((project) => project.name)).toEqual([
      "XDP Networking Paper",
      "PythonTeX Computational Gallery",
    ]);
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

  it("uses stable revisioned archive names", () => {
    expect(researchSeedArchiveName(RESEARCH_SEED_PROJECTS[0])).toBe(
      "ieee-conference-paper-typst-01c8cd53646f.zip",
    );
  });
});

describe.runIf(process.env.OLEAFLY_VERIFY_RESEARCH_SEEDS === "1")(
  "live pinned research sources",
  () => {
    it("still exposes every selected file at its pinned revision", async () => {
      const trees = new Map<string, Promise<{ path: string; type: string; size?: number }[]>>();
      const loadTree = (repository: string, revision: string) => {
        const key = `${repository}@${revision}`;
        const cached = trees.get(key);
        if (cached) return cached;
        const request = fetch(
          `https://api.github.com/repos/${repository}/git/trees/${revision}?recursive=1`,
          { headers: { Accept: "application/vnd.github+json" } },
        ).then(async (response) => {
          expect(response.status, key).toBe(200);
          const body = await response.json() as {
            tree: { path: string; type: string; size?: number }[];
            truncated: boolean;
          };
          expect(body.truncated, `${key} tree must not be truncated`).toBe(false);
          return body.tree;
        });
        trees.set(key, request);
        return request;
      };

      for (const project of RESEARCH_SEED_PROJECTS) {
        const prefixes = project.include.filter((include) => include.endsWith("/"));
        const exactPaths = new Set([
          project.mainDoc,
          ...project.include.filter((include) => !include.endsWith("/")),
        ]);
        if (prefixes.length > 0) {
          const tree = await loadTree(project.repository, project.revision);
          const blobs = new Set(tree.filter((entry) => entry.type === "blob").map((entry) => entry.path));
          expect(blobs.has(project.mainDoc), `${project.name}: missing main document`).toBe(true);
          for (const prefix of prefixes) {
            expect(
              [...blobs].some((path) => path.startsWith(prefix)),
              `${project.name}: missing ${prefix}`,
            ).toBe(true);
          }
          for (const path of exactPaths) {
            expect(blobs.has(path), `${project.name}: missing ${path}`).toBe(true);
          }
          continue;
        }
        for (const path of exactPaths) {
          const encodedPath = path.split("/").map(encodeURIComponent).join("/");
          const response = await fetch(
            `https://raw.githubusercontent.com/${project.repository}/${project.revision}/${encodedPath}`,
            { method: "HEAD" },
          );
          expect(response.status, `${project.name}: missing ${path}`).toBe(200);
        }
      }
    }, 120_000);
  },
);
