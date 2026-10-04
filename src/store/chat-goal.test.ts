import { beforeEach, describe, expect, it } from "vitest";
import { goalForProject, useChatGoalStore } from "./chat-goal";

beforeEach(() => {
  localStorage.clear();
  useChatGoalStore.setState({ goalsByProject: {}, loaded: {} });
});

describe("chat goal store", () => {
  it("loads an empty goal when the project has no saved goal", () => {
    expect(useChatGoalStore.getState().load("project-a")).toBe("");
    expect(goalForProject(useChatGoalStore.getState().goalsByProject, "project-a")).toBe("");
  });

  it("trims and persists the project goal", () => {
    useChatGoalStore.getState().setGoal("project-a", "  Finish the Stage 3 UX  ");

    expect(useChatGoalStore.getState().goal("project-a")).toBe("Finish the Stage 3 UX");

    useChatGoalStore.setState({ goalsByProject: {}, loaded: {} });
    expect(useChatGoalStore.getState().load("project-a")).toBe("Finish the Stage 3 UX");
  });

  it("clears the saved project goal", () => {
    useChatGoalStore.getState().setGoal("project-a", "Finish the Stage 3 UX");
    useChatGoalStore.getState().clearGoal("project-a");

    expect(useChatGoalStore.getState().goal("project-a")).toBe("");

    useChatGoalStore.setState({ goalsByProject: {}, loaded: {} });
    expect(useChatGoalStore.getState().load("project-a")).toBe("");
  });
});

describe("chat goal without a project", () => {
  it("has no goal, stores nothing and reads a loaded goal from memory", () => {
    const store = useChatGoalStore.getState();
    expect(store.load(null)).toBe("");
    expect(store.goal(null)).toBe("");
    store.setGoal(null, "Ignored");
    expect(localStorage.length).toBe(0);
    expect(goalForProject({}, null)).toBe("");

    localStorage.setItem("oleafly.chat-goal.project-b", "  Draft the abstract ");
    expect(store.goal("project-b")).toBe("Draft the abstract");
    localStorage.setItem("oleafly.chat-goal.project-b", "Changed elsewhere");

    expect(useChatGoalStore.getState().load("project-b")).toBe("Draft the abstract");
    expect(goalForProject({}, "project-b")).toBe("");
  });
});
