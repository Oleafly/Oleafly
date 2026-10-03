import { describe, expect, it } from "vitest";
import { analyze, compile, readFacet, sortItems, writeFacet } from "@oleafly/search-query";
import { i18n } from "@/i18n";
import type { ProjectInfo } from "@/lib/tauri";
import {
  buildProjectSearchSchema,
  PROJECT_FACETS,
  projectEngine,
  projectEngineLabel,
  type ProjectSearchExtension,
} from "./project-search";

const DAY = 86_400;
const NOW = Date.UTC(2026, 9, 2, 12) / 1000;

function project(id: string, overrides: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    id,
    name: id,
    main_doc: "main.tex",
    kind: "document",
    created_at: NOW - DAY,
    updated_at: NOW - DAY,
    has_preview: false,
    exports: [],
    forked_from: null,
    recovery_pending: false,
    ...overrides,
  };
}

const PROJECTS = [
  project("thesis", { name: "PhD Thesis", created_at: NOW - 400 * DAY, has_preview: true, last_opened_at: NOW }),
  project("notes", { name: "Lab notes", main_doc: "notes.md", engine: "markdown", updated_at: NOW - 40 * DAY }),
  project("poster", { name: "Poster", main_doc: "poster.typ", kind: "image", forked_from: "thesis", color: "#fde4cf" }),
  project("linked", {
    name: "Linked paper",
    location: { kind: "linked", display_path: "~/Papers/linked", availability: "ok" },
    exports: [{ date: NOW, filename: "camera-ready.pdf", path: "out/camera-ready.pdf", format: "pdf" }],
  }),
];

function search(query: string, extensions: readonly ProjectSearchExtension[] = []) {
  const schema = buildProjectSearchSchema(
    i18n.t.bind(i18n) as never,
    {
      favorites: ["thesis"],
      modified: { linked: NOW },
      colorOf: (item) => item.color ?? "#1982c4",
      colorLabels: { Blue: "Blue", Peach: "Peach" },
    },
    extensions,
  );
  const analyzed = analyze(query, schema, { now: NOW * 1000 });
  const compiled = compile(analyzed, schema, { now: NOW * 1000 });
  return {
    analyzed,
    ids: sortItems(PROJECTS.filter(compiled.test), compiled.sort).map((item) => item.id),
  };
}

const ids = (query: string) => [...search(query).ids].sort((a, b) => a.localeCompare(b));

describe("projectEngine", () => {
  it("reads the engine from the manifest or the main file", () => {
    expect(projectEngine({ engine: "Typst", main_doc: "a.tex" })).toBe("typst");
    expect(projectEngine({ engine: undefined, main_doc: "notes.MARKDOWN" })).toBe("markdown");
    expect(projectEngine({ engine: "pandoc", main_doc: "x" })).toBe("markdown");
    expect(projectEngineLabel({ engine: "", main_doc: "main.tex" })).toBe("LaTeX");
  });
});

describe("project search schema", () => {
  it("filters by engine, kind and their aliases", () => {
    expect(ids("engine:typst")).toEqual(["poster"]);
    expect(ids("engine:latex")).toEqual(["linked", "thesis"]);
    expect(ids("engine:typst,md")).toEqual(["notes", "poster"]);
    expect(ids("-engine:latex")).toEqual(["notes", "poster"]);
    expect(ids("-engine:tectonic")).toEqual(["notes", "poster"]);
    expect(ids("type:image")).toEqual(["poster"]);
  });

  it("supports is:, has: and no: flags", () => {
    expect(ids("is:bookmarked")).toEqual(["thesis"]);
    expect(ids("is:starred")).toEqual(["thesis"]);
    expect(ids("is:folder")).toEqual(["linked"]);
    expect(ids("is:library -is:forked")).toEqual(["notes", "thesis"]);
    expect(ids("has:pdf")).toEqual(["thesis"]);
    expect(ids("has:exports")).toEqual(["linked"]);
    expect(ids("no:preview no:exports")).toEqual(["notes", "poster"]);
  });

  it("matches cover colours by name", () => {
    expect(ids("color:peach")).toEqual(["poster"]);
    expect(ids("colour:blue")).toEqual(["linked", "notes", "thesis"]);
  });

  it("compares created, updated and opened dates", () => {
    expect(ids("created:<@today-1y")).toEqual(["thesis"]);
    expect(ids("updated:>@today-1w")).toEqual(["linked", "poster", "thesis"]);
    expect(ids("modified:<@today-30d")).toEqual(["notes"]);
    expect(ids("opened:@today")).toEqual(["thesis"]);
  });

  it("searches text everywhere by default and narrows with in:", () => {
    expect(ids("camera")).toEqual(["linked"]);
    expect(ids("papers")).toEqual(["linked"]);
    expect(ids("markdown")).toEqual(["notes"]);
    expect(ids("peach")).toEqual(["poster"]);
    expect(ids("paper in:name")).toEqual(["linked"]);
    expect(ids("notes in:file")).toEqual(["notes"]);
    expect(ids("camera in:name")).toEqual([]);
  });

  it("sorts by name, creation and recent activity", () => {
    expect(search("sort:name-asc").ids).toEqual(["notes", "linked", "thesis", "poster"]);
    expect(search("sort:created-asc").ids[0]).toBe("thesis");
    expect(search("").ids[0]).toBe("thesis");
  });

  it("lets later features add flags, fields and sorts", () => {
    const extension: ProjectSearchExtension = {
      is: [{ value: "shared", meta: { label: "Shared" }, test: (item) => item.id === "notes" }],
      fields: [
        {
          key: "owner",
          type: "text",
          test: (item, needle) => (needle === "@me" ? item.id === "poster" : false),
        },
      ],
      sorts: [{ value: "length", compare: (a, b) => a.name.length - b.name.length }],
    };
    expect(search("is:shared", [extension]).ids).toEqual(["notes"]);
    expect(search("owner:@me", [extension]).ids).toEqual(["poster"]);
    expect(search("sort:length-asc", [extension]).ids[0]).toBe("poster");
  });
});

describe("project facets", () => {
  it("round-trips the advanced filter panel through the query", () => {
    const { analyzed } = search("draft");
    let query = writeFacet("draft", analyzed, PROJECT_FACETS.created, "7");
    expect(query).toBe("draft created:>@today-1w");
    query = writeFacet(query, search(query).analyzed, PROJECT_FACETS.bookmark, "no");
    expect(query).toBe("draft created:>@today-1w -is:bookmarked");
    query = writeFacet(query, search(query).analyzed, PROJECT_FACETS.sort, "name-asc");
    expect(readFacet(search(query).analyzed, PROJECT_FACETS.sort)).toEqual({ kind: "option", id: "name-asc" });
    expect(readFacet(search(query).analyzed, PROJECT_FACETS.location)).toEqual({ kind: "none" });
    expect(readFacet(search("is:linked").analyzed, PROJECT_FACETS.location)).toEqual({ kind: "option", id: "external" });
    expect(readFacet(search("no:pdf").analyzed, PROJECT_FACETS.preview)).toEqual({ kind: "option", id: "no" });
  });
});
