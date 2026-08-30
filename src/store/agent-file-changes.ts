import { create } from "zustand";
import { E2E_HOOKS } from "@/lib/e2e-flags";

export interface LineChangeCounts {
  additions: number;
  deletions: number;
}

export interface AgentFileChange extends LineChangeCounts {
  path: string;
  beforeContent: string;
  afterContent: string;
  created?: boolean;
  commitId?: string;
}

export interface AgentFileCommit {
  id: string;
  files: string[];
}

export interface AgentFileChangeTurn {
  chatId: string;
  turnId: string;
  projectId?: string | null;
  headOid: string | null;
  changedFiles: Record<string, AgentFileChange>;
  committedFiles: AgentFileChange[];
  commits: AgentFileCommit[];
}

export interface AgentFileChangesState {
  turns: Record<string, AgentFileChangeTurn>;
  activeTurnByChat: Record<string, string>;
  lastTurnByChat: Record<string, string>;
  beginTurn: (
    chatId: string,
    turnId: string,
    headOid?: string | null,
    projectId?: string | null,
  ) => void;
  recordFileChange: (
    chatId: string,
    turnId: string,
    path: string,
    beforeContent: string,
    afterContent: string,
    options?: { created?: boolean },
  ) => void;
  recordCommit: (
    chatId: string,
    turnId: string,
    commitId: string,
    committedContents: Readonly<Record<string, string>>,
  ) => void;
  finishTurn: (chatId: string, turnId: string) => void;
  seedTurn: (turn: AgentFileChangeTurn) => void;
  clearChat: (chatId: string) => void;
  clear: () => void;
}

const MAX_DIFF_WORK = 2_000_000;

function normalizeContent(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

function contentLines(content: string): string[] {
  const normalized = normalizeContent(content);
  if (!normalized) return [];
  const lines = normalized.split("\n");
  if (normalized.endsWith("\n")) lines.pop();
  return lines;
}

export function diffLineCounts(beforeContent: string, afterContent: string): LineChangeCounts {
  const before = contentLines(beforeContent);
  const after = contentLines(afterContent);
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (
    beforeEnd > start &&
    afterEnd > start &&
    before[beforeEnd - 1] === after[afterEnd - 1]
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  const oldLines = before.slice(start, beforeEnd);
  const newLines = after.slice(start, afterEnd);
  const oldCount = oldLines.length;
  const newCount = newLines.length;
  if (oldCount === 0) return { additions: newCount, deletions: 0 };
  if (newCount === 0) return { additions: 0, deletions: oldCount };

  const max = oldCount + newCount;
  const offset = max + 1;
  const frontier = new Int32Array(max * 2 + 3);
  frontier.fill(-1);
  frontier[offset + 1] = 0;
  let work = 0;

  for (let distance = 0; distance <= max; distance += 1) {
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      work += 1;
      if (work > MAX_DIFF_WORK) {
        return { additions: newCount, deletions: oldCount };
      }
      const index = offset + diagonal;
      let oldIndex =
        diagonal === -distance ||
        (diagonal !== distance && frontier[index - 1] < frontier[index + 1])
          ? frontier[index + 1]
          : frontier[index - 1] + 1;
      let newIndex = oldIndex - diagonal;
      while (
        oldIndex < oldCount &&
        newIndex < newCount &&
        oldLines[oldIndex] === newLines[newIndex]
      ) {
        oldIndex += 1;
        newIndex += 1;
      }
      frontier[index] = oldIndex;
      if (oldIndex >= oldCount && newIndex >= newCount) {
        const delta = newCount - oldCount;
        return {
          additions: (distance + delta) / 2,
          deletions: (distance - delta) / 2,
        };
      }
    }
  }

  return { additions: newCount, deletions: oldCount };
}

export function agentFileChangeTurnKey(chatId: string, turnId: string): string {
  return JSON.stringify([chatId, turnId]);
}

export function agentFileChangeTurnForChat(
  state: Pick<AgentFileChangesState, "turns" | "activeTurnByChat" | "lastTurnByChat">,
  chatId: string | null,
): AgentFileChangeTurn | null {
  if (!chatId) return null;
  const key = state.activeTurnByChat[chatId] ?? state.lastTurnByChat[chatId];
  return key ? state.turns[key] ?? null : null;
}

export function activeAgentFileChangeTurnForProject(
  state: Pick<AgentFileChangesState, "turns" | "activeTurnByChat">,
  projectId: string,
): AgentFileChangeTurn | null {
  for (const key of Object.values(state.activeTurnByChat)) {
    const turn = state.turns[key];
    if (turn?.projectId === projectId) return turn;
  }
  return null;
}

export function agentFileChangeTotals(
  turn: AgentFileChangeTurn | null | undefined,
): { files: number; additions: number; deletions: number } {
  if (!turn) return { files: 0, additions: 0, deletions: 0 };
  const changed = Object.values(turn.changedFiles);
  const files = new Set([
    ...changed.map((file) => file.path),
    ...turn.committedFiles.map((file) => file.path),
  ]);
  return [...changed, ...turn.committedFiles].reduce(
    (totals, file) => ({
      files: files.size,
      additions: totals.additions + file.additions,
      deletions: totals.deletions + file.deletions,
    }),
    { files: files.size, additions: 0, deletions: 0 },
  );
}

function compactFileChange(change: AgentFileChange): AgentFileChange {
  return { ...change, beforeContent: "", afterContent: "" };
}

export const useAgentFileChangesStore = create<AgentFileChangesState>((set) => ({
  turns: {},
  activeTurnByChat: {},
  lastTurnByChat: {},
  beginTurn: (chatId, turnId, headOid = null, projectId = null) => {
    const key = agentFileChangeTurnKey(chatId, turnId);
    set((state) => {
      const turns = { ...state.turns };
      const previous = state.lastTurnByChat[chatId];
      if (previous && previous !== key) delete turns[previous];
      turns[key] = {
        chatId,
        turnId,
        projectId,
        headOid,
        changedFiles: {},
        committedFiles: [],
        commits: [],
      };
      return {
        turns,
        activeTurnByChat: { ...state.activeTurnByChat, [chatId]: key },
        lastTurnByChat: { ...state.lastTurnByChat, [chatId]: key },
      };
    });
  },
  recordFileChange: (chatId, turnId, path, beforeContent, afterContent, options) => {
    const key = agentFileChangeTurnKey(chatId, turnId);
    set((state) => {
      const turn = state.turns[key];
      if (!turn) return state;
      const current = turn.changedFiles[path];
      const baseline = current?.beforeContent ?? normalizeContent(beforeContent);
      const latest = normalizeContent(afterContent);
      const counts = diffLineCounts(baseline, latest);
      const created = current?.created === true || options?.created === true;
      const changedFiles = { ...turn.changedFiles };
      if (counts.additions === 0 && counts.deletions === 0 && !created) {
        delete changedFiles[path];
      } else {
        changedFiles[path] = {
          path,
          beforeContent: baseline,
          afterContent: latest,
          ...(created ? { created: true } : {}),
          ...counts,
        };
      }
      return {
        turns: { ...state.turns, [key]: { ...turn, changedFiles } },
      };
    });
  },
  recordCommit: (chatId, turnId, commitId, committedContents) => {
    const key = agentFileChangeTurnKey(chatId, turnId);
    set((state) => {
      const turn = state.turns[key];
      if (!turn || turn.commits.some((commit) => commit.id === commitId)) return state;
      const changedFiles = { ...turn.changedFiles };
      const committedFiles = [...turn.committedFiles];
      const files: string[] = [];
      for (const [path, change] of Object.entries(turn.changedFiles)) {
        if (!Object.hasOwn(committedContents, path)) continue;
        const committedContent = normalizeContent(committedContents[path]);
        const committedCounts = diffLineCounts(change.beforeContent, committedContent);
        if (
          committedCounts.additions > 0 ||
          committedCounts.deletions > 0 ||
          change.created === true
        ) {
          committedFiles.push({
            path,
            beforeContent: change.beforeContent,
            afterContent: committedContent,
            ...(change.created === true ? { created: true } : {}),
            commitId,
            ...committedCounts,
          });
          files.push(path);
        }
        const remainingCounts = diffLineCounts(committedContent, change.afterContent);
        if (remainingCounts.additions === 0 && remainingCounts.deletions === 0) {
          delete changedFiles[path];
        } else {
          changedFiles[path] = {
            path,
            beforeContent: committedContent,
            afterContent: change.afterContent,
            ...remainingCounts,
          };
        }
      }
      return {
        turns: {
          ...state.turns,
          [key]: {
            ...turn,
            headOid: commitId,
            changedFiles,
            committedFiles,
            commits: [...turn.commits, { id: commitId, files }],
          },
        },
      };
    });
  },
  finishTurn: (chatId, turnId) => {
    const key = agentFileChangeTurnKey(chatId, turnId);
    set((state) => {
      if (state.activeTurnByChat[chatId] !== key) return state;
      const activeTurnByChat = { ...state.activeTurnByChat };
      delete activeTurnByChat[chatId];
      const turn = state.turns[key];
      if (!turn) return { activeTurnByChat };
      const changedFiles = Object.fromEntries(
        Object.entries(turn.changedFiles).map(([path, change]) => [path, compactFileChange(change)]),
      );
      return {
        activeTurnByChat,
        turns: {
          ...state.turns,
          [key]: {
            ...turn,
            changedFiles,
            committedFiles: turn.committedFiles.map(compactFileChange),
          },
        },
      };
    });
  },
  seedTurn: (turn) => {
    const key = agentFileChangeTurnKey(turn.chatId, turn.turnId);
    set((state) => {
      const turns = { ...state.turns };
      const previous = state.lastTurnByChat[turn.chatId];
      if (previous && previous !== key) delete turns[previous];
      turns[key] = turn;
      return {
        turns,
        activeTurnByChat: { ...state.activeTurnByChat, [turn.chatId]: key },
        lastTurnByChat: { ...state.lastTurnByChat, [turn.chatId]: key },
      };
    });
  },
  clearChat: (chatId) => {
    set((state) => {
      const turns = Object.fromEntries(
        Object.entries(state.turns).filter(([, turn]) => turn.chatId !== chatId),
      );
      const activeTurnByChat = { ...state.activeTurnByChat };
      const lastTurnByChat = { ...state.lastTurnByChat };
      delete activeTurnByChat[chatId];
      delete lastTurnByChat[chatId];
      return { turns, activeTurnByChat, lastTurnByChat };
    });
  },
  clear: () => set({ turns: {}, activeTurnByChat: {}, lastTurnByChat: {} }),
}));

if (typeof window !== "undefined" && E2E_HOOKS) {
  const target = window as unknown as {
    __agentFileChangesSet?: (turn: AgentFileChangeTurn) => void;
    __agentFileChangesClear?: () => void;
  };
  target.__agentFileChangesSet = (turn) => useAgentFileChangesStore.getState().seedTurn(turn);
  target.__agentFileChangesClear = () => useAgentFileChangesStore.getState().clear();
}
