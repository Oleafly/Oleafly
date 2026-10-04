import { beforeEach, describe, expect, it } from "vitest";
import { useOpenFolderFlowStore } from "./open-folder-flow";

const prompt = { name: "thesis", project: "Thesis", compile: true, assistant: false };

beforeEach(() => {
  useOpenFolderFlowStore.getState().answer(false);
  useOpenFolderFlowStore.setState({ prompt: null, refusal: null, opening: false });
});

describe("open folder flow", () => {
  it("resolves a stop prompt with the user's answer and hides it", async () => {
    const answer = useOpenFolderFlowStore.getState().ask(prompt);
    expect(useOpenFolderFlowStore.getState().prompt).toEqual(prompt);

    useOpenFolderFlowStore.getState().answer(true);

    await expect(answer).resolves.toBe(true);
    expect(useOpenFolderFlowStore.getState().prompt).toBeNull();
  });

  it("declines an earlier prompt when a new one replaces it", async () => {
    const first = useOpenFolderFlowStore.getState().ask(prompt);
    const second = useOpenFolderFlowStore.getState().ask({ ...prompt, name: "notes" });

    await expect(first).resolves.toBe(false);
    expect(useOpenFolderFlowStore.getState().prompt?.name).toBe("notes");

    useOpenFolderFlowStore.getState().answer(true);
    await expect(second).resolves.toBe(true);
  });

  it("hides a prompt even when nobody is waiting for it", () => {
    useOpenFolderFlowStore.setState({ prompt });

    useOpenFolderFlowStore.getState().answer(true);

    expect(useOpenFolderFlowStore.getState().prompt).toBeNull();
  });

  it("shows and clears a refusal and tracks an open in progress", () => {
    const refusal = { title: "Too broad", message: "Choose a project folder.", hint: null, browse: null };

    useOpenFolderFlowStore.getState().refuse(refusal);
    useOpenFolderFlowStore.getState().setOpening(true);
    expect(useOpenFolderFlowStore.getState()).toMatchObject({ refusal, opening: true });

    useOpenFolderFlowStore.getState().clearRefusal();
    expect(useOpenFolderFlowStore.getState().refusal).toBeNull();
  });
});
