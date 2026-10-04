import { beforeEach, describe, expect, it } from "vitest";
import {
  activeAgentFileChangeTurnForProject,
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

describe("line change counts for large or unterminated files", () => {
  it("counts a last line without a newline", () => {
    expect(diffLineCounts("a\nb", "a\nc")).toEqual({ additions: 1, deletions: 1 });
  });

  it("counts every differing line when the diff is too large to align", () => {
    const before = Array.from({ length: 1500 }, (_, index) => `old ${index}`).join("\n");
    const after = Array.from({ length: 1500 }, (_, index) => `new ${index}`).join("\n");

    expect(diffLineCounts(before, after)).toEqual({ additions: 1500, deletions: 1500 });
  });
});

describe("agent file change bookkeeping", () => {
  const key = (chatId: string, turnId: string) => JSON.stringify([chatId, turnId]);

  it("forgets a file whose edits were reverted within the turn", () => {
    const store = useAgentFileChangesStore.getState();
    store.beginTurn("chat-1", "turn-1");
    store.recordFileChange("chat-1", "turn-1", "main.tex", "a\r\nb\r\n", "a\nchanged\n");
    store.recordFileChange("chat-1", "turn-1", "main.tex", "a\nchanged\n", "a\nb\n");

    const turn = useAgentFileChangesStore.getState().turns[key("chat-1", "turn-1")];
    expect(turn.changedFiles).toEqual({});
  });

  it("ignores changes and commits for a turn that never began", () => {
    const store = useAgentFileChangesStore.getState();
    store.recordFileChange("chat-1", "ghost", "main.tex", "a\n", "b\n");
    store.recordCommit("chat-1", "ghost", "c1", { "main.tex": "b\n" });
    store.finishTurn("chat-1", "ghost");

    expect(useAgentFileChangesStore.getState().turns).toEqual({});
  });

  it("records a commit only once", () => {
    const store = useAgentFileChangesStore.getState();
    store.beginTurn("chat-1", "turn-1");
    store.recordFileChange("chat-1", "turn-1", "main.tex", "a\n", "b\n");
    store.recordCommit("chat-1", "turn-1", "c1", { "main.tex": "b\n" });
    store.recordCommit("chat-1", "turn-1", "c1", { "main.tex": "b\n" });

    const turn = useAgentFileChangesStore.getState().turns[key("chat-1", "turn-1")];
    expect(turn.commits).toEqual([{ id: "c1", files: ["main.tex"] }]);
    expect(turn.committedFiles).toHaveLength(1);
  });

  it("keeps the uncommitted remainder of a file after a partial commit", () => {
    const store = useAgentFileChangesStore.getState();
    store.beginTurn("chat-1", "turn-1");
    store.recordFileChange("chat-1", "turn-1", "main.tex", "one\n", "one\ntwo\nthree\n");
    store.recordCommit("chat-1", "turn-1", "c1", { "main.tex": "one\ntwo\n" });

    const turn = useAgentFileChangesStore.getState().turns[key("chat-1", "turn-1")];
    expect(turn.headOid).toBe("c1");
    expect(turn.committedFiles[0]).toMatchObject({ path: "main.tex", additions: 1, deletions: 0, commitId: "c1" });
    expect(turn.changedFiles["main.tex"]).toMatchObject({
      beforeContent: "one\ntwo\n",
      afterContent: "one\ntwo\nthree\n",
      additions: 1,
      deletions: 0,
    });
    expect(agentFileChangeTotals(turn)).toEqual({ files: 1, additions: 2, deletions: 0 });
  });

  it("leaves the turn active when another turn finishes", () => {
    const store = useAgentFileChangesStore.getState();
    store.beginTurn("chat-1", "turn-2");
    store.finishTurn("chat-1", "turn-1");

    expect(useAgentFileChangesStore.getState().activeTurnByChat["chat-1"]).toBe(key("chat-1", "turn-2"));
  });

  it("finds the running turn of a project", () => {
    const store = useAgentFileChangesStore.getState();
    store.beginTurn("chat-1", "turn-1", null, "project-a");
    store.beginTurn("chat-2", "turn-1", null, "project-b");

    const state = useAgentFileChangesStore.getState();
    expect(activeAgentFileChangeTurnForProject(state, "project-b")?.chatId).toBe("chat-2");
    expect(activeAgentFileChangeTurnForProject(state, "project-c")).toBeNull();

    store.finishTurn("chat-2", "turn-1");
    expect(activeAgentFileChangeTurnForProject(useAgentFileChangesStore.getState(), "project-b")).toBeNull();
  });

  it("finds nothing for no chat or an unknown chat", () => {
    const state = useAgentFileChangesStore.getState();
    expect(agentFileChangeTurnForChat(state, null)).toBeNull();
    expect(agentFileChangeTurnForChat(state, "nobody")).toBeNull();
    expect(agentFileChangeTotals(null)).toEqual({ files: 0, additions: 0, deletions: 0 });
  });

  it("replaces a chat's previous turn with a seeded one", () => {
    const store = useAgentFileChangesStore.getState();
    store.beginTurn("chat-1", "turn-1");
    store.seedTurn({
      chatId: "chat-1",
      turnId: "seeded",
      headOid: "abc",
      changedFiles: {
        "a.tex": { path: "a.tex", beforeContent: "", afterContent: "x", additions: 1, deletions: 0 },
      },
      committedFiles: [],
      commits: [],
    });

    const state = useAgentFileChangesStore.getState();
    expect(Object.keys(state.turns)).toEqual([key("chat-1", "seeded")]);
    expect(agentFileChangeTurnForChat(state, "chat-1")?.turnId).toBe("seeded");

    store.seedTurn({ ...state.turns[key("chat-1", "seeded")], headOid: "def" });
    expect(useAgentFileChangesStore.getState().turns[key("chat-1", "seeded")].headOid).toBe("def");
  });

  it("clears one chat's turns and leaves the others", () => {
    const store = useAgentFileChangesStore.getState();
    store.beginTurn("chat-1", "turn-1");
    store.beginTurn("chat-2", "turn-1");

    store.clearChat("chat-1");

    const state = useAgentFileChangesStore.getState();
    expect(Object.keys(state.turns)).toEqual([key("chat-2", "turn-1")]);
    expect(state.activeTurnByChat).toEqual({ "chat-2": key("chat-2", "turn-1") });
    expect(state.lastTurnByChat).toEqual({ "chat-2": key("chat-2", "turn-1") });

    store.clear();
    expect(useAgentFileChangesStore.getState().turns).toEqual({});
  });
});
