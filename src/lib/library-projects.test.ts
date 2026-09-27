import { describe, expect, it } from "vitest";
import type { ProjectAvailability, ProjectInfo } from "@/lib/tauri";
import {
  folderAvailability,
  folderDisplayPath,
  folderUnavailable,
  isFolderProject,
  projectActivityAt,
  projectInScope,
  projectUpdatedAt,
  sortByActivity,
} from "./library-projects";

function project(id: string, extra: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    id,
    name: id,
    main_doc: "main.tex",
    engine: "tectonic",
    kind: "document",
    created_at: 1,
    updated_at: 1,
    color: "",
    has_preview: false,
    exports: [],
    forked_from: null,
    recovery_pending: false,
    ...extra,
  };
}

function folder(
  id: string,
  availability: ProjectAvailability = "unknown",
  extra: Partial<ProjectInfo> = {},
): ProjectInfo {
  return project(id, {
    location: { kind: "linked", display_path: `~/Desktop/${id}`, availability },
    ...extra,
  });
}

describe("library scopes", () => {
  const projects = [project("paper"), folder("thesis"), project("notes", { location: { kind: "library" } })];

  it("tells folders from library projects, including listings without a location", () => {
    expect(projects.map(isFolderProject)).toEqual([false, true, false]);
    expect(folderDisplayPath(projects[1])).toBe("~/Desktop/thesis");
    expect(folderDisplayPath(projects[0])).toBeNull();
  });

  it("filters by location", () => {
    expect(projects.filter((p) => projectInScope(p, "all")).map((p) => p.id)).toEqual([
      "paper",
      "thesis",
      "notes",
    ]);
    expect(projects.filter((p) => projectInScope(p, "library")).map((p) => p.id)).toEqual([
      "paper",
      "notes",
    ]);
    expect(projects.filter((p) => projectInScope(p, "external")).map((p) => p.id)).toEqual([
      "thesis",
    ]);
  });
});

describe("activity order", () => {
  const DAY = 86_400;
  const NOW = 1_800_000_000;

  it("takes the later of the last open and the last edit", () => {
    expect(projectActivityAt(project("paper", { updated_at: 10 }), {})).toBe(10);
    expect(projectActivityAt(project("paper", { updated_at: 10, last_opened_at: 40 }), {})).toBe(40);
    expect(projectActivityAt(project("paper", { updated_at: 90, last_opened_at: 40 }), {})).toBe(90);
    expect(projectActivityAt(folder("thesis", "ok", { updated_at: 10, last_opened_at: 40 }), { thesis: 70 })).toBe(70);
    expect(projectActivityAt(project("paper", { updated_at: 10 }), { paper: 70 })).toBe(10);
  });

  it("puts a project opened today above one edited yesterday", () => {
    const openedToday = project("opened-today", {
      updated_at: NOW - 7 * DAY,
      last_opened_at: NOW,
    });
    const editedYesterday = project("edited-yesterday", {
      updated_at: NOW - DAY,
      last_opened_at: NOW - 30 * DAY,
    });
    expect(sortByActivity([editedYesterday, openedToday], {}).map((p) => p.id)).toEqual([
      "opened-today",
      "edited-yesterday",
    ]);
  });

  it("orders folders by their files' last change alongside library projects", () => {
    const listed = [
      project("paper", { updated_at: NOW - 3 * DAY, last_opened_at: NOW - 5 * DAY }),
      folder("thesis", "ok", { updated_at: NOW - 40 * DAY, last_opened_at: NOW - 20 * DAY }),
      folder("slides", "ok", { updated_at: NOW - 10 * DAY }),
    ];
    expect(sortByActivity(listed, {}).map((p) => p.id)).toEqual(["paper", "slides", "thesis"]);
    expect(sortByActivity(listed, { thesis: NOW - DAY }).map((p) => p.id)).toEqual([
      "thesis",
      "paper",
      "slides",
    ]);
  });

  it("breaks ties by id and leaves the input alone", () => {
    const listed = [project("b", { updated_at: 5 }), project("a", { last_opened_at: 5 }), project("c")];
    expect(sortByActivity(listed, {}).map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(listed.map((p) => p.id)).toEqual(["b", "a", "c"]);
  });
});

describe("folder availability", () => {
  it("prefers a fresh check over the listing and treats library projects as reachable", () => {
    const thesis = folder("thesis", "unknown");
    expect(folderAvailability(thesis, {})).toBe("unknown");
    expect(folderAvailability(thesis, { thesis: "offline" })).toBe("offline");
    expect(folderAvailability(project("paper"), { paper: "missing" })).toBe("ok");
  });

  it("only blocks opening for states Oleafly knows are unreachable", () => {
    const states: ProjectAvailability[] = [
      "unknown",
      "ok",
      "missing",
      "offline",
      "replaced",
      "permission_denied",
    ];
    expect(states.filter(folderUnavailable)).toEqual([
      "missing",
      "offline",
      "replaced",
      "permission_denied",
    ]);
  });
});

describe("updated time", () => {
  it("takes the newer of the listing and a folder check for folders only", () => {
    const thesis = folder("thesis", "ok", { updated_at: 100 });
    expect(projectUpdatedAt(thesis, {})).toBe(100);
    expect(projectUpdatedAt(thesis, { thesis: 250 })).toBe(250);
    expect(projectUpdatedAt(thesis, { thesis: 50 })).toBe(100);
    expect(projectUpdatedAt(folder("fresh", "ok", { updated_at: 0 }), { fresh: 40 })).toBe(40);
    expect(projectUpdatedAt(project("paper", { updated_at: 10 }), { paper: 999 })).toBe(10);
  });
});
