import { beforeEach, describe, expect, it } from "vitest";
import {
  agentFileChangeTotals,
  agentFileChangeTurnForChat,
  diffLineCounts,
  useAgentFileChangesStore,
} from "./agent-file-changes";

beforeEach(() => {
  useAgentFileChangesStore.setState({
    turns: {},
    activeTurnByChat: {},
    lastTurnByChat: {},
  });
});

describe("line change counts", () => {
  it("counts added and deleted lines for an edit", () => {
    expect(diffLineCounts("alpha\nbeta\ngamma\n", "alpha\nrevised\nextra\ngamma\n")).toEqual({
      additions: 2,
      deletions: 1,
    });
  });

  it("counts every line in a created file as an addition", () => {
    expect(diffLineCounts("", "first\nsecond\n")).toEqual({
      additions: 2,
      deletions: 0,
    });
  });
});

describe("per-turn file changes", () => {
  it("keeps one current diff per file and aggregates unique file totals", () => {
    const store = useAgentFileChangesStore.getState();
    store.beginTurn("chat-1", "turn-1", "head-0");
    store.recordFileChange(
      "chat-1",
      "turn-1",
      "main.tex",
      "alpha\nbeta\n",
      "alpha\ngamma\n",
    );
    store.recordFileChange(
      "chat-1",
      "turn-1",
      "main.tex",
      "alpha\ngamma\n",
      "alpha\ngamma\ndelta\n",
    );
    store.recordFileChange("chat-1", "turn-1", "notes.md", "", "one\ntwo\n");

    const turn = agentFileChangeTurnForChat(useAgentFileChangesStore.getState(), "chat-1");
    expect(turn?.changedFiles["main.tex"]).toMatchObject({ additions: 2, deletions: 1 });
    expect(turn?.changedFiles["notes.md"]).toMatchObject({ additions: 2, deletions: 0 });
    expect(agentFileChangeTotals(turn)).toEqual({ files: 2, additions: 4, deletions: 1 });
  });

  it("moves committed content out of changed files and tracks a later edit again", () => {
    const store = useAgentFileChangesStore.getState();
    store.beginTurn("chat-1", "turn-1", "head-0");
    store.recordFileChange("chat-1", "turn-1", "main.tex", "alpha\nbeta\n", "alpha\ngamma\n");
    store.recordCommit("chat-1", "turn-1", "abcdef123456", {
      "main.tex": "alpha\ngamma\n",
    });

    let turn = agentFileChangeTurnForChat(useAgentFileChangesStore.getState(), "chat-1");
    expect(turn?.changedFiles).toEqual({});
    expect(turn?.committedFiles).toEqual([
      expect.objectContaining({
        path: "main.tex",
        additions: 1,
        deletions: 1,
        commitId: "abcdef123456",
      }),
    ]);
    expect(turn?.commits).toEqual([{ id: "abcdef123456", files: ["main.tex"] }]);

    useAgentFileChangesStore
      .getState()
      .recordFileChange(
        "chat-1",
        "turn-1",
        "main.tex",
        "alpha\ngamma\n",
        "alpha\ngamma\ndelta\n",
      );

    turn = agentFileChangeTurnForChat(useAgentFileChangesStore.getState(), "chat-1");
    expect(turn?.changedFiles["main.tex"]).toMatchObject({ additions: 1, deletions: 0 });
    expect(turn?.committedFiles).toHaveLength(1);
    expect(agentFileChangeTotals(turn)).toEqual({ files: 1, additions: 2, deletions: 1 });
  });

  it("leaves files changed when a commit did not include them", () => {
    const store = useAgentFileChangesStore.getState();
    store.beginTurn("chat-1", "turn-1", "head-0");
    store.recordFileChange("chat-1", "turn-1", "main.tex", "old\n", "new\n");
    store.recordFileChange("chat-1", "turn-1", "notes.md", "before\n", "after\n");
    store.recordCommit("chat-1", "turn-1", "commit-1", { "main.tex": "new\n" });

    const turn = agentFileChangeTurnForChat(useAgentFileChangesStore.getState(), "chat-1");
    expect(turn?.committedFiles.map((file) => file.path)).toEqual(["main.tex"]);
    expect(Object.keys(turn?.changedFiles ?? {})).toEqual(["notes.md"]);
  });

  it("keeps an empty created file visible before and after commit", () => {
    const store = useAgentFileChangesStore.getState();
    store.beginTurn("chat-1", "turn-1", "head-0");
    store.recordFileChange("chat-1", "turn-1", "empty.md", "", "", { created: true });

    let turn = agentFileChangeTurnForChat(useAgentFileChangesStore.getState(), "chat-1");
    expect(turn?.changedFiles["empty.md"]).toMatchObject({
      created: true,
      additions: 0,
      deletions: 0,
    });
    expect(agentFileChangeTotals(turn)).toEqual({ files: 1, additions: 0, deletions: 0 });

    useAgentFileChangesStore
      .getState()
      .recordCommit("chat-1", "turn-1", "commit-empty", { "empty.md": "" });
    turn = agentFileChangeTurnForChat(useAgentFileChangesStore.getState(), "chat-1");
    expect(turn?.changedFiles).toEqual({});
    expect(turn?.committedFiles).toEqual([
      expect.objectContaining({ path: "empty.md", created: true, commitId: "commit-empty" }),
    ]);
  });

  it("resets the active summary for a new turn and keeps the last finished turn", () => {
    const store = useAgentFileChangesStore.getState();
    store.beginTurn("chat-1", "turn-1", "head-0");
    store.recordFileChange("chat-1", "turn-1", "main.tex", "old\n", "new\n");
    store.finishTurn("chat-1", "turn-1");

    const finished = agentFileChangeTurnForChat(useAgentFileChangesStore.getState(), "chat-1");
    expect(finished?.turnId).toBe("turn-1");
    expect(finished?.changedFiles["main.tex"]).toMatchObject({
      beforeContent: "",
      afterContent: "",
      additions: 1,
      deletions: 1,
    });

    useAgentFileChangesStore.getState().beginTurn("chat-1", "turn-2", "head-1");
    const state = useAgentFileChangesStore.getState();
    const current = agentFileChangeTurnForChat(state, "chat-1");
    expect(current?.turnId).toBe("turn-2");
    expect(agentFileChangeTotals(current)).toEqual({ files: 0, additions: 0, deletions: 0 });
    expect(state.turns[JSON.stringify(["chat-1", "turn-1"])]).toBeUndefined();
  });
});
