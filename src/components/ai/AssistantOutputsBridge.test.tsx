// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revealEditorLine: vi.fn(async () => true),
  filesState: { projectId: "proj" as string | null },
}));

vi.mock("@/lib/ai-tools", () => ({ revealEditorLine: mocks.revealEditorLine }));
vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => mocks.filesState },
}));

import {
  AssistantOutputsBridge,
  editorIsBusy,
  firstChangedLine,
} from "./AssistantOutputsBridge";
import { useAgentFileChangesStore } from "@/store/agent-file-changes";
import { useAssistantOutputsStore } from "@/store/assistant-outputs";

function flush() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

beforeEach(() => {
  mocks.revealEditorLine.mockClear().mockResolvedValue(true);
  mocks.filesState.projectId = "proj";
  useAgentFileChangesStore.getState().clear();
  useAssistantOutputsStore.setState({ fileOpen: null, pdfEpoch: 0 });
  document.body.innerHTML = "";
});

describe("firstChangedLine", () => {
  it("points at the first line that differs", () => {
    expect(firstChangedLine("a\nb\nc", "a\nB\nc")).toBe(2);
    expect(firstChangedLine("a\nb", "a\nb\nc")).toBe(3);
    expect(firstChangedLine("same", "same")).toBe(1);
    expect(firstChangedLine("", "brand new file")).toBe(1);
  });
});

describe("editorIsBusy", () => {
  it("is busy while the caret sits in the editor", () => {
    document.body.innerHTML = '<div class="cm-editor"><span id="caret"></span></div>';
    const caret = document.getElementById("caret");
    expect(editorIsBusy(10_000, 0, caret)).toBe(true);
  });

  it("stays busy for two seconds after the last editor keystroke", () => {
    expect(editorIsBusy(1_500, 0, null)).toBe(true);
    expect(editorIsBusy(2_500, 0, null)).toBe(false);
  });
});

describe("AssistantOutputsBridge", () => {
  it("opens a file the assistant wrote at its first changed line", async () => {
    render(<AssistantOutputsBridge />);
    const changes = useAgentFileChangesStore.getState();
    changes.beginTurn("chat", "turn", null, "proj");
    changes.recordFileChange("chat", "turn", "main.tex", "one\ntwo\n", "one\nTWO\n");

    useAssistantOutputsStore.getState().openFile("main.tex", "write");
    await flush();

    expect(mocks.revealEditorLine).toHaveBeenCalledWith("main.tex", 2);
  });

  it("opens a written file at the top when no diff was recorded", async () => {
    render(<AssistantOutputsBridge />);

    useAssistantOutputsStore.getState().openFile("notes.tex", "write");
    await flush();

    expect(mocks.revealEditorLine).toHaveBeenCalledWith("notes.tex", 1);
  });

  it("ignores files the assistant only read", async () => {
    render(<AssistantOutputsBridge />);

    useAssistantOutputsStore.getState().openFile("main.tex", "read");
    await flush();

    expect(mocks.revealEditorLine).not.toHaveBeenCalled();
  });

  it("stays out of the way while the user is in the editor", async () => {
    document.body.innerHTML = '<div class="cm-editor"><textarea id="caret"></textarea></div>';
    (document.getElementById("caret") as HTMLTextAreaElement).focus();
    render(<AssistantOutputsBridge />);

    useAssistantOutputsStore.getState().openFile("main.tex", "write");
    await flush();

    expect(mocks.revealEditorLine).not.toHaveBeenCalled();
  });

  it("does not treat its own reveal as the user working in the editor", async () => {
    document.body.innerHTML = '<div class="cm-editor"><textarea id="caret"></textarea></div>';
    const caret = document.getElementById("caret") as HTMLTextAreaElement;
    mocks.revealEditorLine.mockImplementation(async () => {
      caret.focus();
      caret.blur();
      return true;
    });
    render(<AssistantOutputsBridge />);

    useAssistantOutputsStore.getState().openFile("first.tex", "write");
    await flush();
    expect(mocks.revealEditorLine).toHaveBeenCalledWith("first.tex", 1);

    useAssistantOutputsStore.getState().openFile("second.tex", "write");
    await flush();

    expect(mocks.revealEditorLine).toHaveBeenCalledWith("second.tex", 1);
  });

  it("stops listening once the project view unmounts", async () => {
    const view = render(<AssistantOutputsBridge />);
    view.unmount();

    useAssistantOutputsStore.getState().openFile("main.tex", "write");
    await flush();

    expect(mocks.revealEditorLine).not.toHaveBeenCalled();
  });
});
