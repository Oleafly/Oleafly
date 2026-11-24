import { learnedAfter, mergeLearnedWords, syncedBase, useDictionary } from "@/lib/dictionary";
import { logInfo, logWarning } from "@/lib/log";
import { type OverleafLearnedWords, overleafLiveLearnedWords, overleafLiveLearnWords } from "@/lib/overleaf-live";
import { type CollabLiveStoreState, useCollabLiveStore } from "./live-store";

export const LEARNED_BATCH = 200;
export const LEARNED_SETTLE_MS = 400;

interface Synced {
  projectId: string;
  account: string;
  remote: string[];
}

function liveOn(state: CollabLiveStoreState): string | null {
  return state.backend === "overleaf" && state.status?.state === "online" ? state.projectId : null;
}

function sessionOf(state: CollabLiveStoreState): string | null {
  return state.backend === "overleaf" && state.status?.state !== "ended" ? state.projectId : null;
}

export function startLearnedWords(): () => void {
  let run = 0;
  let synced: Synced | null = null;
  let pushing = false;
  let again = false;
  let settle: ReturnType<typeof setTimeout> | null = null;
  let stopWatching: (() => void) | null = null;

  const current = (mine: number) => mine === run && synced !== null;

  const send = async (mine: number, words: Synced, queue: readonly [string, boolean][]): Promise<boolean> => {
    let rest = queue;
    while (rest.length > 0) {
      const batch = rest.slice(0, LEARNED_BATCH);
      rest = rest.slice(LEARNED_BATCH);
      const learn = batch.filter(([, learning]) => learning).map(([word]) => word);
      const unlearn = batch.filter(([, learning]) => !learning).map(([word]) => word);
      const sent = await overleafLiveLearnWords(words.projectId, learn, unlearn);
      if (!current(mine)) return false;
      const base = useDictionary.getState().synced[words.account] ?? null;
      words.remote = learnedAfter(words.remote, sent);
      useDictionary
        .getState()
        .setSynced(words.account, syncedBase(words.remote, useDictionary.getState().global, base));
      if (sent.stopped) {
        void logWarning("send learned words to Overleaf", `stopped: ${sent.stopped}`);
        return false;
      }
    }
    return true;
  };

  const push = async (mine: number): Promise<void> => {
    if (!current(mine)) return;
    if (pushing) {
      again = true;
      return;
    }
    pushing = true;
    try {
      let going = true;
      while (going && current(mine) && synced) {
        again = false;
        const words = synced;
        const dictionary = useDictionary.getState();
        const base = dictionary.synced[words.account] ?? null;
        const merged = mergeLearnedWords(base, words.remote, dictionary.global);
        dictionary.applyLearned(merged.addLocal, merged.removeLocal);
        const queue: [string, boolean][] = [
          ...merged.unlearn.map((word): [string, boolean] => [word, false]),
          ...merged.learn.map((word): [string, boolean] => [word, true]),
        ];
        if (queue.length === 0) {
          const local = useDictionary.getState().global;
          useDictionary.getState().setSynced(words.account, syncedBase(words.remote, local, base));
        }
        going = (await send(mine, words, queue)) && again;
      }
    } catch (error) {
      if (current(mine)) void logWarning("send learned words to Overleaf", error);
    } finally {
      pushing = false;
      if (again && mine !== run) void push(run);
    }
  };

  const watch = (mine: number) => {
    stopWatching = useDictionary.subscribe((state, previous) => {
      if (state.global === previous.global || !current(mine)) return;
      if (settle) clearTimeout(settle);
      settle = setTimeout(() => {
        settle = null;
        void push(mine);
      }, LEARNED_SETTLE_MS);
    });
  };

  const begin = async (projectId: string) => {
    const mine = ++run;
    let learned: OverleafLearnedWords;
    try {
      learned = await overleafLiveLearnedWords(projectId);
    } catch (error) {
      if (mine === run) void logWarning("read learned words from Overleaf", error);
      return;
    }
    if (mine !== run) return;
    if (learned.words === null) {
      void logInfo("read learned words from Overleaf", "the editor page did not list them");
      return;
    }
    synced = { projectId, account: learned.account, remote: learned.words };
    watch(mine);
    await push(mine);
  };

  const pause = () => {
    run++;
    again = false;
    if (settle) clearTimeout(settle);
    settle = null;
    stopWatching?.();
    stopWatching = null;
  };

  const resume = (projectId: string) => {
    if (synced?.projectId !== projectId) {
      void begin(projectId);
      return;
    }
    const mine = ++run;
    watch(mine);
    void push(mine);
  };

  let session = sessionOf(useCollabLiveStore.getState());
  let live = liveOn(useCollabLiveStore.getState());
  if (live) void begin(live);
  const unsubscribe = useCollabLiveStore.subscribe((state) => {
    const nextSession = sessionOf(state);
    const next = liveOn(state);
    if (next === live && nextSession === session) return;
    if (nextSession !== session) synced = null;
    session = nextSession;
    live = next;
    pause();
    if (next) resume(next);
  });

  return () => {
    unsubscribe();
    pause();
    synced = null;
  };
}
