import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./live-editing", () => ({ startLiveEditing: vi.fn(() => () => undefined) }));

import { useCollabEditorGate, useCollabLiveNote, useCollabLiveProject } from "@/lib/collab-live-bridge";
import { useEditMode } from "../suggestions/edit-mode";
import { useCollabLiveStore } from "./live-store";
import { startLiveTarget } from "./note-slot";

const SESSION = { projectId: "p1", role: "editor" as const, accountId: "alice", deviceId: "laptop" };

afterEach(() => {
  useCollabLiveStore.setState({ projectId: null, backend: null, role: null });
  useCollabEditorGate.setState({ projectId: null, viewer: false, locked: false, connecting: false, suggesting: false });
  useEditMode.setState({ projectId: null, mode: null });
  useCollabLiveNote.setState({ noteId: null, session: null });
});

describe("the live target", () => {
  it.each(["server", "overleaf"] as const)("publishes the live project for its project notes on %s", (backend) => {
    useCollabLiveStore.setState({ projectId: "p1", backend });
    const stop = startLiveTarget(SESSION);
    expect(useCollabLiveProject.getState().session).toEqual(SESSION);
    stop();
    expect(useCollabLiveProject.getState().session).toBeNull();
  });

  it("follows my edit mode, so rich text locks while my edits are suggestions", () => {
    useCollabLiveStore.setState({ projectId: "p1", backend: "overleaf", role: "editor" });
    useCollabEditorGate.setState({ projectId: "p1" });
    useEditMode.setState({ projectId: "p1", mode: "suggesting" });
    const stop = startLiveTarget(SESSION);
    expect(useCollabEditorGate.getState().suggesting).toBe(true);
    useEditMode.setState({ mode: "editing" });
    expect(useCollabEditorGate.getState().suggesting).toBe(false);
    useEditMode.setState({ projectId: "other", mode: "suggesting" });
    expect(useCollabEditorGate.getState().suggesting).toBe(false);
    useEditMode.setState({ projectId: "p1" });
    expect(useCollabEditorGate.getState().suggesting).toBe(true);
    stop();
    expect(useCollabEditorGate.getState().suggesting).toBe(false);
  });

  it("follows the edit mode of a whole live note too", () => {
    useCollabLiveNote.setState({ noteId: "p1" });
    useCollabLiveStore.setState({ projectId: "p1", backend: "server", role: "editor" });
    useEditMode.setState({ projectId: "p1", mode: "suggesting" });
    const stop = startLiveTarget(SESSION);
    expect(useCollabEditorGate.getState()).toMatchObject({ projectId: "p1", suggesting: true, locked: false });
    stop();
    expect(useCollabEditorGate.getState()).toMatchObject({ projectId: null, suggesting: false });
  });
});
