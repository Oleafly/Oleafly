import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  learned: vi.fn(),
  learn: vi.fn(),
  logWarning: vi.fn(),
  logInfo: vi.fn(),
}));

vi.mock("@/lib/overleaf-live", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/overleaf-live")>()),
  overleafLiveLearnedWords: mocks.learned,
  overleafLiveLearnWords: mocks.learn,
}));
vi.mock("@/lib/log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log")>()),
  logWarning: mocks.logWarning,
  logInfo: mocks.logInfo,
}));

import { useDictionary } from "@/lib/dictionary";
import { LEARNED_BATCH, LEARNED_SETTLE_MS, startLearnedWords } from "./learned-words";
import { useCollabLiveStore } from "./live-store";

const ACCOUNT = "https://latex.uni.edu\nalice";

function goLive(projectId = "paper") {
  useCollabLiveStore.setState({ projectId, backend: "overleaf", status: { state: "online" } });
}

function goOffline() {
  useCollabLiveStore.setState({ status: { state: "offline", retry_in_ms: 1000 } });
}

function accepting() {
  mocks.learn.mockImplementation(async (_project: string, learn: string[], unlearn: string[]) => ({
    learned: learn,
    unlearned: unlearn,
    stopped: null,
  }));
}

let stop: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  useDictionary.setState({ ignored: {}, global: [], suppressed: {}, synced: {}, revision: 0 });
  useCollabLiveStore.setState({ projectId: null, backend: null, status: null });
  accepting();
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
});

describe("learned words while live on Overleaf", () => {
  it("merges both ways on the first sync and remembers the agreed words", async () => {
    useDictionary.setState({ global: ["Ratel", "oleaflyish"] });
    mocks.learned.mockResolvedValue({ account: ACCOUNT, words: ["Oleaflyish", "Zeta"] });
    stop = startLearnedWords();
    goLive();
    await vi.waitFor(() => expect(mocks.learn).toHaveBeenCalledTimes(1));
    expect(mocks.learned).toHaveBeenCalledWith("paper");
    expect(mocks.learn).toHaveBeenCalledWith("paper", ["Ratel"], []);
    await vi.waitFor(() =>
      expect(useDictionary.getState().synced[ACCOUNT]?.slice().sort()).toEqual(["Oleaflyish", "Ratel", "Zeta"]),
    );
    expect(useDictionary.getState().global).toEqual(["Ratel", "oleaflyish", "Zeta"]);
  });

  it("sends later changes, unlearns a cleared dictionary and waits for typing to settle", async () => {
    mocks.learned.mockResolvedValue({ account: ACCOUNT, words: ["Zeta"] });
    useDictionary.setState({ global: ["Zeta"], synced: { [ACCOUNT]: ["Zeta"] } });
    stop = startLearnedWords();
    goLive();
    await vi.waitFor(() => expect(mocks.learned).toHaveBeenCalled());
    useDictionary.getState().ignoreGlobal("Kappa");
    useDictionary.getState().ignoreGlobal("Lambda");
    expect(mocks.learn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(LEARNED_SETTLE_MS);
    await vi.waitFor(() => expect(mocks.learn).toHaveBeenCalledWith("paper", ["Kappa", "Lambda"], []));
    mocks.learn.mockClear();
    useDictionary.getState().clearGlobal();
    await vi.advanceTimersByTimeAsync(LEARNED_SETTLE_MS);
    await vi.waitFor(() => expect(mocks.learn).toHaveBeenCalledTimes(1));
    expect(mocks.learn.mock.calls[0][2].slice().sort()).toEqual(["Kappa", "Lambda", "Zeta"]);
    await vi.waitFor(() => expect(useDictionary.getState().synced[ACCOUNT]).toEqual([]));
  });

  it("sends a long list in batches and stops at the first refusal", async () => {
    const words = Array.from({ length: LEARNED_BATCH * 2 + 5 }, (_, at) => `w${at}`);
    useDictionary.setState({ global: words });
    mocks.learned.mockResolvedValue({ account: ACCOUNT, words: [] });
    mocks.learn
      .mockImplementationOnce(async (_project: string, learn: string[]) => ({ learned: learn, unlearned: [], stopped: null }))
      .mockImplementationOnce(async (_project: string, learn: string[]) => ({
        learned: learn.slice(0, 3),
        unlearned: [],
        stopped: "too_large",
      }));
    stop = startLearnedWords();
    goLive();
    await vi.waitFor(() => expect(mocks.logWarning).toHaveBeenCalledWith("send learned words to Overleaf", "stopped: too_large"));
    expect(mocks.learn).toHaveBeenCalledTimes(2);
    expect(mocks.learn.mock.calls[0][1]).toHaveLength(LEARNED_BATCH);
    expect(useDictionary.getState().synced[ACCOUNT]).toHaveLength(LEARNED_BATCH + 3);
  });

  it("does nothing when the page has no learned words and only reads them on each move to live", async () => {
    mocks.learned.mockResolvedValue({ account: ACCOUNT, words: null });
    useDictionary.setState({ global: ["Ratel"] });
    stop = startLearnedWords();
    goLive();
    await vi.waitFor(() => expect(mocks.logInfo).toHaveBeenCalled());
    expect(mocks.learn).not.toHaveBeenCalled();
    expect(useDictionary.getState().synced).toEqual({});
    useCollabLiveStore.setState({ pending: 3 });
    expect(mocks.learned).toHaveBeenCalledTimes(1);
    goOffline();
    goLive();
    await vi.waitFor(() => expect(mocks.learned).toHaveBeenCalledTimes(2));
  });

  it("drops an answer that arrives after live editing stopped and stops listening", async () => {
    let answer: (value: unknown) => void = () => undefined;
    mocks.learned.mockResolvedValue({ account: ACCOUNT, words: [] });
    mocks.learn.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    useDictionary.setState({ global: ["Ratel"] });
    stop = startLearnedWords();
    goLive();
    await vi.waitFor(() => expect(mocks.learn).toHaveBeenCalledTimes(1));
    goOffline();
    answer({ learned: ["Ratel"], unlearned: [], stopped: null });
    await vi.runAllTimersAsync();
    expect(useDictionary.getState().synced).toEqual({});
    stop();
    stop = null;
    useDictionary.getState().ignoreGlobal("Kappa");
    await vi.advanceTimersByTimeAsync(LEARNED_SETTLE_MS * 2);
    expect(mocks.learn).toHaveBeenCalledTimes(1);
  });

  it("keeps the words agreed on after a reconnect in the same session, since the page list is not read again", async () => {
    useDictionary.setState({ global: ["Ratel"] });
    mocks.learned.mockResolvedValue({ account: ACCOUNT, words: ["Zeta"] });
    stop = startLearnedWords();
    goLive();
    await vi.waitFor(() => expect(useDictionary.getState().synced[ACCOUNT]?.slice().sort()).toEqual(["Ratel", "Zeta"]));
    expect(useDictionary.getState().global).toEqual(["Ratel", "Zeta"]);
    mocks.learn.mockClear();
    goOffline();
    useCollabLiveStore.setState({ status: { state: "idle" } });
    goLive();
    await vi.runAllTimersAsync();
    expect(mocks.learned).toHaveBeenCalledTimes(1);
    expect(mocks.learn).not.toHaveBeenCalled();
    expect(useDictionary.getState().global).toEqual(["Ratel", "Zeta"]);
    expect(useDictionary.getState().synced[ACCOUNT]?.slice().sort()).toEqual(["Ratel", "Zeta"]);
  });

  it("sends words learned while offline once it is back, and reads the list again for a new session", async () => {
    mocks.learned.mockResolvedValue({ account: ACCOUNT, words: [] });
    stop = startLearnedWords();
    goLive();
    await vi.waitFor(() => expect(mocks.learned).toHaveBeenCalledTimes(1));
    goOffline();
    useDictionary.getState().ignoreGlobal("Kappa");
    await vi.advanceTimersByTimeAsync(LEARNED_SETTLE_MS * 2);
    expect(mocks.learn).not.toHaveBeenCalled();
    goLive();
    await vi.waitFor(() => expect(mocks.learn).toHaveBeenCalledExactlyOnceWith("paper", ["Kappa"], []));
    expect(mocks.learned).toHaveBeenCalledTimes(1);
    useCollabLiveStore.setState({ status: { state: "ended", reason: "failed" } });
    useCollabLiveStore.setState({ status: null });
    goLive();
    await vi.waitFor(() => expect(mocks.learned).toHaveBeenCalledTimes(2));
  });

  it("sends a change made during a reconnect that caught a send on its way", async () => {
    let answer: (value: unknown) => void = () => undefined;
    mocks.learned.mockResolvedValue({ account: ACCOUNT, words: [] });
    useDictionary.setState({ global: ["Ratel"] });
    mocks.learn.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    stop = startLearnedWords();
    goLive();
    await vi.waitFor(() => expect(mocks.learn).toHaveBeenCalledTimes(1));
    goOffline();
    useDictionary.getState().ignoreGlobal("Kappa");
    goLive();
    answer({ learned: ["Ratel"], unlearned: [], stopped: null });
    await vi.waitFor(() => expect(mocks.learn).toHaveBeenCalledTimes(2));
    expect(mocks.learn.mock.calls[1][1].slice().sort()).toEqual(["Kappa", "Ratel"]);
  });

  it("logs a failed read and leaves the dictionary alone", async () => {
    mocks.learned.mockRejectedValue({ code: "not_found", message: "this project is not live" });
    useDictionary.setState({ global: ["Ratel"] });
    stop = startLearnedWords();
    goLive();
    await vi.waitFor(() => expect(mocks.logWarning).toHaveBeenCalledWith("read learned words from Overleaf", expect.anything()));
    expect(mocks.learn).not.toHaveBeenCalled();
    expect(useDictionary.getState().global).toEqual(["Ratel"]);
  });
});
