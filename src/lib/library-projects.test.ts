import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectAvailability, ProjectInfo } from "@/lib/tauri";
import enLibrary from "@/i18n/locales/en/library.json" with { type: "json" };
import {
  RECENT_LIMIT,
  folderAvailability,
  folderDisplayPath,
  folderOpenedLabel,
  folderUnavailable,
  isFolderProject,
  projectInScope,
  recentProjects,
  scopeCounts,
  splitFolderPath,
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

  it("filters and counts by scope", () => {
    expect(projects.filter((p) => projectInScope(p, "all")).map((p) => p.id)).toEqual([
      "paper",
      "thesis",
      "notes",
    ]);
    expect(projects.filter((p) => projectInScope(p, "library")).map((p) => p.id)).toEqual([
      "paper",
      "notes",
    ]);
    expect(projects.filter((p) => projectInScope(p, "folders")).map((p) => p.id)).toEqual([
      "thesis",
    ]);
    expect(scopeCounts(projects)).toEqual({ all: 3, library: 2, folders: 1 });
  });
});

describe("recent projects", () => {
  it("mixes folders and library projects by when they were last opened", () => {
    const listed = [
      project("never"),
      project("old", { last_opened_at: 100 }),
      folder("thesis", "ok", { last_opened_at: 300 }),
      project("paper", { last_opened_at: 200 }),
      folder("slides", "missing", { last_opened_at: 250 }),
      project("recovering", { last_opened_at: 999, recovery_pending: true }),
    ];
    expect(recentProjects(listed).map((p) => p.id)).toEqual([
      "thesis",
      "slides",
      "paper",
      "old",
    ]);
  });

  it("keeps a stable order for ties and stops at the limit", () => {
    const listed = Array.from({ length: RECENT_LIMIT + 3 }, (_, index) =>
      project(`p${String(index).padStart(2, "0")}`, { last_opened_at: index < 2 ? 1 : index }),
    );
    const recent = recentProjects(listed);
    expect(recent).toHaveLength(RECENT_LIMIT);
    expect(recent[0].id).toBe(`p${String(RECENT_LIMIT + 2).padStart(2, "0")}`);
    expect(recentProjects(listed, 20).slice(-2).map((p) => p.id)).toEqual(["p00", "p01"]);
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

describe("opened labels", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 26, 15, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  it("says today, yesterday, or the date", () => {
    const seconds = (date: Date) => date.getTime() / 1000;
    expect(folderOpenedLabel(seconds(new Date(2026, 8, 26, 9)))).toBe(enLibrary.folder.openedToday);
    expect(folderOpenedLabel(seconds(new Date(2026, 8, 25, 23)))).toBe(
      enLibrary.folder.openedYesterday,
    );
    expect(folderOpenedLabel(seconds(new Date(2026, 5, 2, 12)))).toMatch(/^Opened Jun 2$/);
    expect(folderOpenedLabel(seconds(new Date(2025, 5, 2, 12)))).toMatch(/2025/);
    expect(folderOpenedLabel(0)).toBeUndefined();
  });
});

describe("folder paths", () => {
  it("keep the last two parts together so the folder name survives truncation", () => {
    expect(splitFolderPath("~/Library/Mobile Documents/com~apple~CloudDocs/2024/thesis")).toEqual({
      head: "~/Library/Mobile Documents/com~apple~CloudDocs",
      tail: "/2024/thesis",
    });
    expect(splitFolderPath("~/Desktop/thesis")).toEqual({ head: "~", tail: "/Desktop/thesis" });
    expect(splitFolderPath("C:\\Users\\me\\Documents\\thesis")).toEqual({
      head: "C:\\Users\\me",
      tail: "\\Documents\\thesis",
    });
    expect(splitFolderPath("\\\\server\\share\\thesis")).toEqual({
      head: "\\\\server",
      tail: "\\share\\thesis",
    });
  });

  it("leave short paths whole", () => {
    for (const path of ["thesis", "/thesis", "/Volumes/thesis", "~/thesis", ""]) {
      expect(splitFolderPath(path)).toEqual({ head: "", tail: path });
    }
  });
});
