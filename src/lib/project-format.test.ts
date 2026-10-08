import { afterEach, describe, expect, it, vi } from "vitest";
import { projectDateTime, projectModifiedLabel } from "./project-format";

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
