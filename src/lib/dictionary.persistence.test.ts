import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import {
  DICTIONARY_LIMITS,
  ignoreWordForProject,
  ignoreWordGlobally,
  isGrammarFindingSuppressed,
  setDictionaryNotice,
  suppressGrammarFinding,
  useDictionary,
} from "./dictionary";

const STORAGE_KEY = "oleafly.dictionary";

async function rehydrate(state: unknown) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, version: 0 }));
  await useDictionary.persist.rehydrate();
  return useDictionary.getState();
}

const words = (count: number, prefix = "w") => Array.from({ length: count }, (_, i) => `${prefix}${i}`);

beforeEach(() => {
  useDictionary.setState({ ignored: {}, global: [], suppressed: {}, revision: 0 });
});

afterEach(() => {
  localStorage.removeItem(STORAGE_KEY);
  setDictionaryNotice(null);
});

describe("restoring the saved dictionary", () => {
  it("keeps clean words and drops duplicates, non-strings and unusable entries", async () => {
    const state = await rehydrate({
      global: ["  Spanner ", "spanner", 7, "", "x".repeat(DICTIONARY_LIMITS.wordCharacters + 1), "bad\u0007word", "Ratel"],
      ignored: {
        proj: ["Foo", "foo", null, "Bar"],
        empty: ["", 3],
        notList: "Foo",
        __proto__: ["Polluted"],
        constructor: ["Polluted"],
        "": ["Nameless"],
        "id\u0000x": ["Control"],
      },
      suppressed: {
        proj: ["rule:1", "rule:1", 5, "", "x".repeat(DICTIONARY_LIMITS.suppressionCharacters + 1), "ctl\u0001"],
        other: "rule:2",
        none: [],
        prototype: ["rule:3"],
      },
    });
    expect(state.global).toEqual(["Spanner", "Ratel"]);
    expect(state.ignored).toEqual({ proj: ["Foo", "Bar"] });
    expect(state.suppressed).toEqual({ proj: ["rule:1"] });
  });

  it("starts empty from a missing or malformed saved state", async () => {
    expect(await rehydrate(null)).toMatchObject({ global: [], ignored: {}, suppressed: {} });
    expect(await rehydrate({ global: "Spanner", ignored: ["not", "a", "map"], suppressed: ["x"] })).toMatchObject({
      global: [],
      ignored: {},
      suppressed: {},
    });
  });

  it("caps the number of project scopes and suppressions it restores", async () => {
    const ignored = Object.fromEntries(Array.from({ length: DICTIONARY_LIMITS.projectScopes + 5 }, (_, i) => [`p${i}`, ["Word"]]));
    const suppressed = Object.fromEntries(
      Array.from({ length: DICTIONARY_LIMITS.projectScopes + 5 }, (_, i) => [`p${i}`, i === 0 ? words(DICTIONARY_LIMITS.suppressionsPerProject + 10, "k") : ["k"]]),
    );
    const state = await rehydrate({ ignored, suppressed });
    expect(Object.keys(state.ignored)).toHaveLength(DICTIONARY_LIMITS.projectScopes);
    expect(Object.keys(state.suppressed)).toHaveLength(DICTIONARY_LIMITS.projectScopes);
    expect(state.suppressed.p0).toHaveLength(DICTIONARY_LIMITS.suppressionsPerProject);
  });

  it("caps words per scope and across all projects", async () => {
    const state = await rehydrate({
      global: words(DICTIONARY_LIMITS.wordsPerScope + 3, "g"),
      ignored: {
        a: words(DICTIONARY_LIMITS.wordsPerScope + 10, "a"),
        b: words(DICTIONARY_LIMITS.wordsPerScope, "b"),
        c: words(DICTIONARY_LIMITS.wordsPerScope, "c"),
        d: words(DICTIONARY_LIMITS.wordsPerScope, "d"),
        e: words(10, "e"),
      },
    });
    expect(state.global).toHaveLength(DICTIONARY_LIMITS.wordsPerScope);
    expect(state.ignored.a).toHaveLength(DICTIONARY_LIMITS.wordsPerScope);
    const total = Object.values(state.ignored).reduce((sum, list) => sum + list.length, 0);
    expect(total).toBe(DICTIONARY_LIMITS.totalProjectWords);
    expect(state.ignored.e).toBeUndefined();
  });
});

describe("dictionary limits when learning words", () => {
  it("reports a full project dictionary", () => {
    const notice = vi.fn();
    setDictionaryNotice(notice);
    useDictionary.setState({ ignored: { proj: words(DICTIONARY_LIMITS.wordsPerScope) } });
    expect(ignoreWordForProject("proj", "Overflow")).toBe("limit_reached");
    expect(notice).toHaveBeenCalledWith(enCore.dictionary.full);
  });

  it("reports a full personal dictionary", () => {
    const notice = vi.fn();
    setDictionaryNotice(notice);
    useDictionary.setState({ global: words(DICTIONARY_LIMITS.wordsPerScope) });
    expect(ignoreWordGlobally("Overflow")).toBe("limit_reached");
    expect(notice).toHaveBeenCalledWith(enCore.dictionary.full);
  });

  it("refuses a new project scope once every scope is taken", () => {
    setDictionaryNotice(vi.fn());
    useDictionary.setState({
      ignored: Object.fromEntries(Array.from({ length: DICTIONARY_LIMITS.projectScopes }, (_, i) => [`p${i}`, ["Word"]])),
    });
    expect(ignoreWordForProject("fresh", "Word")).toBe("limit_reached");
    expect(ignoreWordForProject("p0", "Another")).toBe("stored");
  });

  it("refuses a project word once the total across projects is reached", () => {
    setDictionaryNotice(vi.fn());
    useDictionary.setState({
      ignored: {
        a: words(DICTIONARY_LIMITS.wordsPerScope, "a"),
        b: words(DICTIONARY_LIMITS.wordsPerScope, "b"),
        c: words(DICTIONARY_LIMITS.wordsPerScope, "c"),
        d: words(DICTIONARY_LIMITS.wordsPerScope, "d"),
      },
    });
    expect(ignoreWordForProject("e", "Word")).toBe("limit_reached");
  });

  it("ignores direct writes with an unusable project id or word", () => {
    const store = useDictionary.getState();
    store.ignore("__proto__", "Word");
    store.ignore("proj", "");
    store.ignoreGlobal("bad\u0007word");
    expect(useDictionary.getState()).toMatchObject({ ignored: {}, global: [], revision: 0 });
  });

  it("does not remember an unusable grammar suppression", () => {
    expect(suppressGrammarFinding("proj", "bad\u0001key")).toBe(false);
    expect(suppressGrammarFinding(null, "rule:1")).toBe(false);
    expect(isGrammarFindingSuppressed("proj", "bad\u0001key")).toBe(false);
  });
});
