import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DICTIONARY_LIMITS, learnedAfter, mergeLearnedWords, syncedBase, useDictionary } from "./dictionary";

const STORAGE_KEY = "oleafly.dictionary";
const ACCOUNT = "https://latex.uni.edu\n64b7f0c2a1e3d4b5c6a7e8f9";

async function rehydrate(state: unknown) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, version: 0 }));
  await useDictionary.persist.rehydrate();
  return useDictionary.getState();
}

beforeEach(() => {
  useDictionary.setState({ ignored: {}, global: [], suppressed: {}, synced: {}, revision: 0 });
});

afterEach(() => {
  localStorage.removeItem(STORAGE_KEY);
});

describe("merging Overleaf's learned words with the personal dictionary", () => {
  it.each([
    {
      name: "the first sync takes both sides",
      base: null,
      remote: ["Zeta", "Oleaflyish"],
      local: ["oleaflyish", "Ratel"],
      expected: { addLocal: ["Zeta"], removeLocal: [], learn: ["Ratel"], unlearn: [] },
    },
    {
      name: "a word learned on Overleaf arrives here",
      base: ["Zeta"],
      remote: ["Zeta", "Kappa"],
      local: ["Zeta"],
      expected: { addLocal: ["Kappa"], removeLocal: [], learn: [], unlearn: [] },
    },
    {
      name: "a word unlearned on Overleaf leaves here",
      base: ["Zeta", "Kappa"],
      remote: ["Zeta"],
      local: ["Zeta", "kappa"],
      expected: { addLocal: [], removeLocal: ["kappa"], learn: [], unlearn: [] },
    },
    {
      name: "a word added here is learned on Overleaf",
      base: ["Zeta"],
      remote: ["Zeta"],
      local: ["Zeta", "Ratel"],
      expected: { addLocal: [], removeLocal: [], learn: ["Ratel"], unlearn: [] },
    },
    {
      name: "a word removed here is unlearned in every spelling Overleaf keeps",
      base: ["Zeta", "zeta"],
      remote: ["Zeta", "zeta", "Kappa"],
      local: ["Kappa"],
      expected: { addLocal: [], removeLocal: [], learn: [], unlearn: ["Zeta", "zeta"] },
    },
    {
      name: "both sides adding or removing the same word agree",
      base: ["Gone"],
      remote: ["Both"],
      local: ["both"],
      expected: { addLocal: [], removeLocal: [], learn: [], unlearn: [] },
    },
    {
      name: "words this dictionary can't keep are left alone on Overleaf",
      base: [],
      remote: ["x".repeat(DICTIONARY_LIMITS.wordCharacters + 1), "ok"],
      local: [],
      expected: { addLocal: ["ok"], removeLocal: [], learn: [], unlearn: [] },
    },
    {
      name: "Overleaf spellings are normalized when they arrive",
      base: [],
      remote: ["  Ｗide  ", "wide"],
      local: [],
      expected: { addLocal: ["Wide"], removeLocal: [], learn: [], unlearn: [] },
    },
  ])("$name", ({ base, remote, local, expected }) => {
    expect(mergeLearnedWords(base, remote, local)).toEqual(expected);
  });

  it("keeps a word in the base while its unlearn has not gone through, so it is not added back", () => {
    const base = ["Zeta", "Kappa"];
    const remote = ["Zeta", "Kappa"];
    const local = ["Kappa"];
    const merged = mergeLearnedWords(base, remote, local);
    expect(merged.unlearn).toEqual(["Zeta"]);
    const failed = syncedBase(learnedAfter(remote, { learned: [], unlearned: [] }), local, base);
    expect(failed).toEqual(["Zeta", "Kappa"]);
    expect(mergeLearnedWords(failed, remote, local).addLocal).toEqual([]);
    const done = syncedBase(learnedAfter(remote, { learned: [], unlearned: ["Zeta"] }), local, base);
    expect(done).toEqual(["Kappa"]);
  });

  it("leaves a word out of the base when its learn did not go through, so it is sent again", () => {
    const local = ["Zeta", "Ratel"];
    const base = syncedBase(learnedAfter(["Zeta"], { learned: [], unlearned: [] }), local, ["Zeta"]);
    expect(base).toEqual(["Zeta"]);
    expect(mergeLearnedWords(base, ["Zeta"], local).learn).toEqual(["Ratel"]);
    expect(learnedAfter(["Zeta"], { learned: ["Ratel"], unlearned: [] })).toEqual(["Zeta", "Ratel"]);
  });
});

describe("the dictionary side of the sync", () => {
  it("applies arrivals and departures in one change and respects the word limit", () => {
    useDictionary.setState({ global: ["Zeta", "Kappa"] });
    const before = useDictionary.getState().revision;
    useDictionary.getState().applyLearned(["Ratel", "ratel", "bad\u0007word"], ["kappa"]);
    expect(useDictionary.getState().global).toEqual(["Zeta", "Ratel"]);
    expect(useDictionary.getState().revision).toBe(before + 1);
    useDictionary.getState().applyLearned([], []);
    expect(useDictionary.getState().revision).toBe(before + 1);
    const full = Array.from({ length: DICTIONARY_LIMITS.wordsPerScope }, (_, at) => `w${at}`);
    useDictionary.setState({ global: full });
    useDictionary.getState().applyLearned(["Extra"], []);
    expect(useDictionary.getState().global).toHaveLength(DICTIONARY_LIMITS.wordsPerScope);
  });

  it("keeps a synced base per account and refuses odd account names", () => {
    const set = useDictionary.getState().setSynced;
    set(ACCOUNT, ["Zeta", "Zeta", "zeta", "bad\u0000"]);
    set("no-separator", ["Zeta"]);
    set("a\nb\nc", ["Zeta"]);
    expect(useDictionary.getState().synced).toEqual({ [ACCOUNT]: ["Zeta", "zeta"] });
    const synced = useDictionary.getState().synced;
    set(ACCOUNT, ["Zeta", "zeta"]);
    expect(useDictionary.getState().synced).toBe(synced);
    for (let at = 0; at < DICTIONARY_LIMITS.syncedAccounts + 3; at++) set(`https://s${at}.edu\nu`, ["w"]);
    expect(Object.keys(useDictionary.getState().synced)).toHaveLength(DICTIONARY_LIMITS.syncedAccounts);
  });

  it("restores only clean synced bases from storage", async () => {
    const many = Array.from({ length: DICTIONARY_LIMITS.syncedWords + 5 }, (_, at) => `w${at}`);
    const state = await rehydrate({
      global: ["Zeta"],
      synced: {
        [ACCOUNT]: ["Zeta", "zeta", 7, null, "", "x".repeat(DICTIONARY_LIMITS.syncedWordCharacters + 1), "a\u0001b"],
        "https://big.edu\nu": many,
        "no separator": ["Zeta"],
        "\nu": ["Zeta"],
        __proto__: ["Polluted"],
        "https://list.edu\nu": "Zeta",
      },
    });
    expect(state.synced[ACCOUNT]).toEqual(["Zeta", "zeta"]);
    expect(state.synced["https://big.edu\nu"]).toHaveLength(DICTIONARY_LIMITS.syncedWords);
    expect(Object.keys(state.synced).sort()).toEqual([ACCOUNT, "https://big.edu\nu"].sort());
    expect(Object.getPrototypeOf(state.synced)).toBe(Object.prototype);
    expect((await rehydrate({ synced: ["not", "a", "map"] })).synced).toEqual({});
    expect((await rehydrate(null)).synced).toEqual({});
  });
});
