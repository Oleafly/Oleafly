import { create } from "zustand";
import type { DraftAttachment } from "@/components/ai/composer/types";

export interface ComposerDraft {
  text: string;
  attachments: readonly DraftAttachment[];
}

interface ComposerDraftsState {
  drafts: Readonly<Record<string, ComposerDraft>>;
  setText(composerId: string, text: string): void;
  addAttachments(composerId: string, items: readonly DraftAttachment[]): void;
  updateAttachment(composerId: string, id: string, patch: Partial<DraftAttachment>): boolean;
  removeAttachments(composerId: string, ids: readonly string[]): void;
  setAttachments(composerId: string, items: readonly DraftAttachment[]): void;
  moveDraft(fromId: string, toId: string): void;
}

export const EMPTY_ATTACHMENTS: readonly DraftAttachment[] = Object.freeze([]);

const EMPTY_DRAFT: ComposerDraft = { text: "", attachments: EMPTY_ATTACHMENTS };

function withDraft(
  drafts: Readonly<Record<string, ComposerDraft>>,
  composerId: string,
  draft: ComposerDraft,
): Readonly<Record<string, ComposerDraft>> {
  if (!draft.text && draft.attachments.length === 0) {
    if (!(composerId in drafts)) return drafts;
    const { [composerId]: _removed, ...rest } = drafts;
    return rest;
  }
  return { ...drafts, [composerId]: draft };
}

export const useComposerDrafts = create<ComposerDraftsState>()((set, get) => ({
  drafts: {},
  setText(composerId, text) {
    set((state) => {
      const current = state.drafts[composerId] ?? EMPTY_DRAFT;
      if (current.text === text) return state;
      return { drafts: withDraft(state.drafts, composerId, { ...current, text }) };
    });
  },
  addAttachments(composerId, items) {
    if (items.length === 0) return;
    set((state) => {
      const current = state.drafts[composerId] ?? EMPTY_DRAFT;
      return {
        drafts: withDraft(state.drafts, composerId, {
          ...current,
          attachments: [...current.attachments, ...items],
        }),
      };
    });
  },
  updateAttachment(composerId, id, patch) {
    const current = get().drafts[composerId];
    if (!current?.attachments.some((item) => item.id === id)) return false;
    set((state) => {
      const draft = state.drafts[composerId];
      if (!draft) return state;
      return {
        drafts: withDraft(state.drafts, composerId, {
          ...draft,
          attachments: draft.attachments.map((item) =>
            item.id === id ? { ...item, ...patch, id } : item,
          ),
        }),
      };
    });
    return true;
  },
  removeAttachments(composerId, ids) {
    if (ids.length === 0) return;
    const remove = new Set(ids);
    set((state) => {
      const draft = state.drafts[composerId];
      if (!draft) return state;
      return {
        drafts: withDraft(state.drafts, composerId, {
          ...draft,
          attachments: draft.attachments.filter((item) => !remove.has(item.id)),
        }),
      };
    });
  },
  setAttachments(composerId, items) {
    set((state) => {
      const current = state.drafts[composerId] ?? EMPTY_DRAFT;
      return {
        drafts: withDraft(state.drafts, composerId, {
          ...current,
          attachments: items.length > 0 ? [...items] : EMPTY_ATTACHMENTS,
        }),
      };
    });
  },
  moveDraft(fromId, toId) {
    if (fromId === toId) return;
    set((state) => {
      const moved = state.drafts[fromId];
      if (!moved) return state;
      const { [fromId]: _moved, ...rest } = state.drafts;
      const target = rest[toId] ?? EMPTY_DRAFT;
      const known = new Set(target.attachments.map((item) => item.id));
      return {
        drafts: withDraft(rest, toId, {
          text: [moved.text, target.text].filter(Boolean).join("\n\n"),
          attachments: [...moved.attachments.filter((item) => !known.has(item.id)), ...target.attachments],
        }),
      };
    });
  },
}));

export function builtinComposerId(projectId: string | null, chatId: string | null = null): string {
  const base = `${projectId ?? "none"}:builtin`;
  return chatId ? `${base}:${chatId}` : base;
}

export function composerHistoryKey(composerId: string): string {
  const colon = composerId.indexOf(":");
  return colon === -1 ? composerId : composerId.slice(0, colon);
}

export function draftText(composerId: string): string {
  return useComposerDrafts.getState().drafts[composerId]?.text ?? "";
}

export function draftAttachments(composerId: string): readonly DraftAttachment[] {
  return useComposerDrafts.getState().drafts[composerId]?.attachments ?? EMPTY_ATTACHMENTS;
}

export function composerHolding(composerId: string, attachmentId: string): string | null {
  const drafts = useComposerDrafts.getState().drafts;
  const holds = (id: string) => drafts[id]?.attachments.some((item) => item.id === attachmentId) ?? false;
  if (holds(composerId)) return composerId;
  const prefix = `${composerHistoryKey(composerId)}:`;
  for (const id of Object.keys(drafts)) {
    if (id.startsWith(prefix) && holds(id)) return id;
  }
  return null;
}

function addRefs(refs: Set<string>, items: readonly DraftAttachment[]): void {
  for (const item of items) {
    if (item.sha256) refs.add(item.sha256);
    for (const page of item.pageImages ?? []) refs.add(page.sha256);
  }
}

const heldAttachments = new Set<readonly DraftAttachment[]>();
const attachmentHolders = new Set<() => Iterable<string>>();

export function holdDraftAttachments(items: readonly DraftAttachment[]): () => void {
  heldAttachments.add(items);
  return () => {
    heldAttachments.delete(items);
  };
}

export function registerAttachmentHolder(holder: () => Iterable<string>): () => void {
  attachmentHolders.add(holder);
  return () => {
    attachmentHolders.delete(holder);
  };
}

export function draftAttachmentRefs(projectId: string): string[] {
  const refs = new Set<string>();
  const prefix = `${projectId}:`;
  for (const [composerId, draft] of Object.entries(useComposerDrafts.getState().drafts)) {
    if (composerId.startsWith(prefix)) addRefs(refs, draft.attachments);
  }
  for (const items of heldAttachments) addRefs(refs, items);
  for (const holder of attachmentHolders) for (const ref of holder()) refs.add(ref);
  return [...refs];
}

export const PROMPT_HISTORY_LIMIT = 50;
const HISTORY_KEY = "oleafly.composer.history";
const HISTORY_PROJECTS = 20;
const HISTORY_MAX_CHARS = 4_000;
export const HISTORY_PROJECT_CHARS = 32_000;

interface StoredHistory {
  v: 1;
  byProject: Record<string, { at: number; items: string[] }>;
}

let historyCache: { raw: string; history: StoredHistory } | null = null;

function readHistory(): StoredHistory {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return { v: 1, byProject: {} };
    if (historyCache?.raw === raw) return historyCache.history;
    const history = parseHistory(raw);
    historyCache = { raw, history };
    return history;
  } catch {
    return { v: 1, byProject: {} };
  }
}

function parseHistory(raw: string): StoredHistory {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredHistory> | null;
    if (parsed?.v !== 1 || typeof parsed.byProject !== "object" || !parsed.byProject) {
      return { v: 1, byProject: {} };
    }
    const byProject: StoredHistory["byProject"] = {};
    for (const [key, entry] of Object.entries(parsed.byProject)) {
      if (!entry || !Array.isArray(entry.items)) continue;
      byProject[key] = {
        at: typeof entry.at === "number" ? entry.at : 0,
        items: entry.items.filter((item): item is string => typeof item === "string"),
      };
    }
    return { v: 1, byProject };
  } catch {
    return { v: 1, byProject: {} };
  }
}

function writeHistory(history: StoredHistory): void {
  try {
    const raw = JSON.stringify(history);
    localStorage.setItem(HISTORY_KEY, raw);
    historyCache = { raw, history };
  } catch {
    // History is a convenience; a full or blocked store only loses recall.
  }
}

function trimHistory(items: readonly string[]): string[] {
  const kept: string[] = [];
  let chars = 0;
  for (let index = items.length - 1; index >= 0 && kept.length < PROMPT_HISTORY_LIMIT; index--) {
    chars += items[index].length;
    if (chars > HISTORY_PROJECT_CHARS) break;
    kept.push(items[index]);
  }
  return kept.reverse();
}

export function promptHistory(composerId: string): readonly string[] {
  return readHistory().byProject[composerHistoryKey(composerId)]?.items ?? [];
}

export function rememberPrompt(composerId: string, text: string): void {
  const prompt = text.trim();
  if (!prompt || prompt.length > HISTORY_MAX_CHARS) return;
  const history: StoredHistory = { v: 1, byProject: { ...readHistory().byProject } };
  const key = composerHistoryKey(composerId);
  const items = (history.byProject[key]?.items ?? []).filter((item) => item !== prompt);
  items.push(prompt);
  const latest = Math.max(0, ...Object.values(history.byProject).map((entry) => entry.at));
  history.byProject[key] = {
    at: Math.max(Date.now(), latest + 1),
    items: trimHistory(items),
  };
  const projects = Object.entries(history.byProject);
  if (projects.length > HISTORY_PROJECTS) {
    projects.sort(([, left], [, right]) => left.at - right.at);
    for (const [oldKey] of projects.slice(0, projects.length - HISTORY_PROJECTS)) {
      delete history.byProject[oldKey];
    }
  }
  writeHistory(history);
}
