import { beforeEach, describe, expect, it } from "vitest";
import { APP_ERROR_PREFIX } from "@/lib/app-error";
import {
  locationErrorAvailability,
  projectFolderAvailable,
  reportLocationError,
  useProjectAvailabilityStore,
} from "./project-availability";

const typed = (code: string) =>
  `${APP_ERROR_PREFIX}${JSON.stringify({ code, params: { folder: "thesis" }, detail: null })}`;

beforeEach(() => {
  useProjectAvailabilityStore.getState().reset("linked-a");
});

describe("project folder availability", () => {
  it("reads the three location error codes and nothing else", () => {
    expect(locationErrorAvailability(typed("project.linked_missing"))).toBe("missing");
    expect(locationErrorAvailability(new Error(typed("project.linked_replaced")))).toBe("replaced");
    expect(locationErrorAvailability(typed("project.linked_permission_denied"))).toBe(
      "permission_denied",
    );
    expect(locationErrorAvailability(typed("project.not_found"))).toBeNull();
    expect(locationErrorAvailability(typed("project.linked_invalid"))).toBeNull();
    expect(locationErrorAvailability(typed("constructor"))).toBeNull();
    expect(locationErrorAvailability("disk full")).toBeNull();
  });

  it("marks only the open project unavailable", () => {
    expect(reportLocationError("linked-b", typed("project.linked_missing"))).toBe(true);
    expect(projectFolderAvailable("linked-a")).toBe(true);
    expect(reportLocationError("linked-a", typed("project.linked_missing"))).toBe(true);
    expect(projectFolderAvailable("linked-a")).toBe(false);
    expect(projectFolderAvailable("linked-b")).toBe(true);
    expect(projectFolderAvailable(null)).toBe(true);
    expect(reportLocationError("linked-a", "disk full")).toBe(false);
  });

  it("treats an offline drive as unavailable and an unknown probe as no news", () => {
    const store = useProjectAvailabilityStore.getState();
    store.report("linked-a", "offline");
    expect(projectFolderAvailable("linked-a")).toBe(false);
    store.report("linked-a", "unknown");
    expect(useProjectAvailabilityStore.getState().availability).toBe("offline");
    store.report("linked-a", "ok");
    expect(projectFolderAvailable("linked-a")).toBe(true);
  });

  it("applies backend events in generation order and counts relocations", () => {
    const store = useProjectAvailabilityStore.getState();
    store.apply({
      projectId: "linked-a",
      availability: "missing",
      locationGeneration: 2,
      relocated: false,
      grantsReset: false,
    });
    store.apply({
      projectId: "linked-a",
      availability: "ok",
      locationGeneration: 3,
      relocated: true,
      grantsReset: true,
    });
    store.apply({
      projectId: "linked-a",
      availability: "missing",
      locationGeneration: 2,
      relocated: false,
      grantsReset: false,
    });
    store.apply({
      projectId: "other",
      availability: "missing",
      locationGeneration: 9,
      relocated: false,
      grantsReset: false,
    });
    expect(useProjectAvailabilityStore.getState()).toMatchObject({
      availability: "ok",
      locationGeneration: 3,
      relocations: 1,
      grantResets: 1,
    });
  });

  it("forgets everything when another project opens", () => {
    const store = useProjectAvailabilityStore.getState();
    store.report("linked-a", "replaced");
    store.reset("linked-b");
    expect(useProjectAvailabilityStore.getState()).toMatchObject({
      projectId: "linked-b",
      availability: "ok",
      locationGeneration: 0,
      relocations: 0,
      grantResets: 0,
    });
  });
});
