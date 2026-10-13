import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "@/store/settings";
import { clearTemplateRequest, openTemplateInNewProject, useTemplateRequestStore } from "./template-request";

beforeEach(() => {
  clearTemplateRequest();
});

describe("template request", () => {
  it("hands an installed template to the new project dialog", () => {
    useSettingsStore.setState({ settingsOpen: true, newProjectOpen: false });
    openTemplateInNewProject("alpha");
    expect(useSettingsStore.getState()).toMatchObject({ settingsOpen: false, newProjectOpen: true });
    expect(useTemplateRequestStore.getState().requestedTemplateId).toBe("alpha");
  });

  it("clears the request once and leaves an empty request alone", () => {
    openTemplateInNewProject("alpha");
    const before = useTemplateRequestStore.getState();
    clearTemplateRequest();
    const cleared = useTemplateRequestStore.getState();
    expect(cleared.requestedTemplateId).toBeNull();
    expect(cleared).not.toBe(before);
    clearTemplateRequest();
    expect(useTemplateRequestStore.getState()).toBe(cleared);
  });
});
