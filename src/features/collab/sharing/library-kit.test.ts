import { beforeAll, describe, expect, it } from "vitest";
import { analyze, compile } from "@oleafly/search-query";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { i18n, loadNamespace } from "@/i18n";
import { buildProjectSearchSchema } from "@/components/library/project-search";
import type { ProjectInfo } from "@/lib/tauri";
import { libraryKit } from "./library-kit";

const NOW = Date.UTC(2026, 9, 2, 12);

function project(id: string, overrides: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    id,
    name: id,
    main_doc: "main.tex",
    kind: "document",
    created_at: 1,
    updated_at: 1,
    has_preview: false,
    exports: [],
    forked_from: null,
    recovery_pending: false,
    ...overrides,
  };
}

const PROJECTS = [
  project("thesis"),
  project("notes", { main_doc: "notes.md" }),
  project("linked", { location: { kind: "linked", display_path: "~/Papers/linked", availability: "ok" } }),
  project("grant", { shared: { server_name: "Smith Lab", role: "owner" } }),
];

let kit: ReturnType<typeof libraryKit>;

function analyzeShared(query: string) {
  const schema = buildProjectSearchSchema(
    i18n.t.bind(i18n) as never,
    { favorites: [], modified: {}, colorOf: () => "#1982c4", colorLabels: {} },
    [kit.extension],
  );
  return { schema, analyzed: analyze(query, schema, { now: NOW }) };
}

function matching(query: string): string[] {
  const { schema, analyzed } = analyzeShared(query);
  const compiled = compile(analyzed, schema, { now: NOW });
  return PROJECTS.filter(compiled.test)
    .map((item) => item.id)
    .sort((a, b) => a.localeCompare(b));
}

function write(query: string, option: string | null): string {
  return kit.writeLocation(query, analyzeShared(query).analyzed, option, (next) => analyzeShared(next).analyzed);
}

beforeAll(async () => {
  await loadNamespace("collab");
  kit = libraryKit(i18n.t.bind(i18n) as never);
});

describe("libraryKit", () => {
  it("names the shared label, menu items and location option in the collab catalog", () => {
    expect(kit).toMatchObject({
      kind: enCollab.library.kind,
      share: enCollab.share.button,
      copyAndShare: enCollab.share.copyAndShare,
      location: enCollab.library.location,
      openLink: enCollab.library.openLink.menu,
    });
    expect(kit.extension.is?.[0].meta?.label).toBe(enCollab.library.flag);
  });

  it("finds shared projects with is:shared and keeps is:library meaning stored in Oleafly", () => {
    expect(matching("is:shared")).toEqual(["grant"]);
    expect(matching("is:library")).toEqual(["grant", "notes", "thesis"]);
  });

  it("writes In Oleafly as library projects that are not shared, so the options never overlap", () => {
    const library = write("draft", "library");
    expect(library).toBe("draft is:library -is:shared");
    expect(matching("is:library -is:shared")).toEqual(["notes", "thesis"]);
    expect(kit.readLocation(analyzeShared(library).analyzed)).toEqual({ kind: "option", id: "library" });
  });

  it("switches between options and clears them without touching other terms", () => {
    const shared = write("draft is:library -is:shared", "shared");
    expect(shared).toBe("draft is:shared");
    expect(kit.readLocation(analyzeShared(shared).analyzed)).toEqual({ kind: "option", id: "shared" });
    const external = write(shared, "external");
    expect(external).toBe("draft is:folder");
    expect(kit.readLocation(analyzeShared(external).analyzed)).toEqual({ kind: "option", id: "external" });
    expect(kit.readLocation(analyzeShared("is:linked").analyzed)).toEqual({ kind: "option", id: "external" });
    expect(write("draft is:library -is:shared", null)).toBe("draft");
    expect(kit.readLocation(analyzeShared("draft").analyzed)).toEqual({ kind: "none" });
  });

  it("calls any other mix of location terms custom", () => {
    expect(kit.readLocation(analyzeShared("is:library").analyzed)).toEqual({ kind: "custom" });
    expect(kit.readLocation(analyzeShared("is:shared is:folder").analyzed)).toEqual({ kind: "custom" });
    expect(kit.readLocation(analyzeShared("-is:shared").analyzed)).toEqual({ kind: "custom" });
  });
});
