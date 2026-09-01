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
