import { afterEach, describe, expect, it, vi } from "vitest";
import { projectDateTime, projectModifiedLabel, shortProjectName } from "./project-format";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("project date labels", () => {
  it("names a date from another year with the year and a recent one without", () => {
    const now = new Date();
    const lastYear = new Date(now.getFullYear() - 1, 2, 4).getTime() / 1000;
    expect(projectModifiedLabel(lastYear)).toContain(String(now.getFullYear() - 1));
    expect(projectModifiedLabel(now.getTime() / 1000)).toBe("Updated today");
  });

  it("reuses its date formatters instead of building one per project", () => {
    const older = new Date(2020, 0, 15).getTime() / 1000;
    projectModifiedLabel(older);
    projectDateTime(older);
    const build = vi.spyOn(Intl, "DateTimeFormat");
    for (let index = 0; index < 50; index += 1) {
      projectModifiedLabel(older + index * 86_400);
      projectDateTime(older + index * 86_400);
    }
    expect(build).not.toHaveBeenCalled();
  });
});

describe("short project names", () => {
  it("keeps names that fit and ends longer ones with an ellipsis", () => {
    expect(shortProjectName("Thesis")).toBe("Thesis");
    expect(shortProjectName("x".repeat(32))).toBe("x".repeat(32));
    expect(shortProjectName("PRAJWAL_SOMENDYAPANAHALLI_VENKATESHMURTHY_RESUME")).toBe("PRAJWAL_SOMENDYAPANAHALLI_VENKA…");
    expect(shortProjectName("Notes on the history of mathematics", 10)).toBe("Notes on…");
    expect(Array.from(shortProjectName("論文".repeat(40)))).toHaveLength(32);
  });
});
