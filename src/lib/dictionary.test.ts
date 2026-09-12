import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  DICTIONARY_LIMITS,
  grammarSuppressionsFor,
  isGrammarFindingSuppressed,
  isWordIgnored,
  ignoreWordForProject,
  ignoreWordGlobally,
  setDictionaryNotice,
  suppressGrammarFinding,
  useDictionary,
} from "@/lib/dictionary";
import { dictionaryWordFromSelection } from "@/lib/dictionary";
import {
  clearWordsIgnoredHere,
  ignoreWordHere,
  isFindingSuppressedHere,
  isWordIgnoredHere,
  suppressFindingHere,
} from "@/lib/proofreading/ignored";

describe("dictionary (ignore list)", () => {
  beforeEach(() => {
    useDictionary.setState({
      ignored: {},
      global: [],
      suppressed: {},
      revision: 0,
    });
  });

  it("ignores a word for one project only", () => {
    ignoreWordForProject("proj1", "Spanner");
    expect(isWordIgnored("proj1", "Spanner")).toBe(true);
    expect(isWordIgnored("proj2", "Spanner")).toBe(false);
    expect(isWordIgnored(null, "Spanner")).toBe(false);
  });

  it("ignores a word globally across every project", () => {
    ignoreWordGlobally("Spanner");
    expect(isWordIgnored("proj1", "Spanner")).toBe(true);
    expect(isWordIgnored("proj2", "Spanner")).toBe(true);
  });

  it("trims whitespace and dedupes", () => {
    ignoreWordForProject("p", "  L5 ");
    ignoreWordForProject("p", "L5");
    expect(useDictionary.getState().ignored.p).toEqual(["L5"]);
    expect(isWordIgnored("p", "L5 ")).toBe(true);
  });

  it("un-ignore removes the word (project and global)", () => {
    ignoreWordForProject("p", "Ratel");
    useDictionary.getState().unignore("p", "Ratel");
    expect(isWordIgnored("p", "Ratel")).toBe(false);

    ignoreWordGlobally("tql");
    useDictionary.getState().unignoreGlobal("tql");
    expect(isWordIgnored("p", "tql")).toBe(false);
  });

  it("does nothing for a null project id", () => {
    ignoreWordForProject(null, "x");
    expect(useDictionary.getState().ignored).toEqual({});
  });
});


const RESET = {
  ignored: {},
  global: [],
  suppressed: {},
  revision: 0,
};

describe("dictionary case folding", () => {
  beforeEach(() => useDictionary.setState(RESET));

  it("clears both foo and Foo when either is learned", () => {
    ignoreWordForProject("p", "foo");
    expect(isWordIgnored("p", "foo")).toBe(true);
    expect(isWordIgnored("p", "Foo")).toBe(true);
    expect(isWordIgnored("p", "FOO")).toBe(true);
  });

  it("clears both cases when the capitalised form is learned", () => {
    ignoreWordGlobally("Foo");
    expect(isWordIgnored("p", "foo")).toBe(true);
    expect(isWordIgnored("p", "Foo")).toBe(true);
  });
});

describe("dictionary write outcomes", () => {
  const notices: string[] = [];

  beforeEach(() => {
    notices.length = 0;
    setDictionaryNotice((message) => void notices.push(message));
    useDictionary.setState(RESET);
  });

  afterEach(() => setDictionaryNotice(null));

  it("reports a stored word and a repeated one differently", () => {
    expect(ignoreWordForProject("p", "Spanner")).toBe("stored");
    expect(ignoreWordForProject("p", "spanner")).toBe("duplicate");
    expect(notices).toEqual([]);
  });

  it("explains a selection that is too long to store", () => {
    const long = "x".repeat(DICTIONARY_LIMITS.wordCharacters + 1);
    expect(ignoreWordGlobally(long)).toBe("unsupported_word");
    expect(useDictionary.getState().global).toEqual([]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("too long");
  });

  it("explains a selection with control characters", () => {
    expect(ignoreWordForProject("p", "bad\u0007word")).toBe(
      "unsupported_word",
    );
    expect(notices).toHaveLength(1);
  });

  it("says nothing was stored without a project", () => {
    expect(ignoreWordForProject(null, "Spanner")).toBe("no_project");
    expect(notices).toEqual([]);
  });
});

describe("grammar suppressions", () => {
  beforeEach(() => useDictionary.setState(RESET));

  it("remembers a dismissed finding for one project only", () => {
    expect(suppressGrammarFinding("p", "RepeatedWords:the the word.")).toBe(
      true,
    );
    expect(
      isGrammarFindingSuppressed("p", "RepeatedWords:the the word."),
    ).toBe(true);
    expect(
      isGrammarFindingSuppressed("other", "RepeatedWords:the the word."),
    ).toBe(false);
  });

  it("cannot remember a dismissal without a project", () => {
    expect(suppressGrammarFinding(null, "RepeatedWords:x")).toBe(false);
  });

  it("stops at the per-project cap", () => {
    for (
      let index = 0;
      index <= DICTIONARY_LIMITS.suppressionsPerProject;
      index++
    ) {
      suppressGrammarFinding("p", `Rule:${index}`);
    }
    expect(grammarSuppressionsFor("p")).toHaveLength(
      DICTIONARY_LIMITS.suppressionsPerProject,
    );
  });

  it("brings dismissed findings back", () => {
    suppressGrammarFinding("p", "Rule:one");
    suppressGrammarFinding("p", "Rule:two");
    useDictionary.getState().unsuppress("p", "Rule:one");
    expect(grammarSuppressionsFor("p")).toEqual(["Rule:two"]);
    useDictionary.getState().clearSuppressed("p");
    expect(grammarSuppressionsFor("p")).toEqual([]);
  });

  it("announces a restored finding only after the store has committed", () => {
    suppressGrammarFinding("p", "Rule:one");
    suppressGrammarFinding("p", "Rule:two");
    const seen: string[][] = [];
    const target = new EventTarget();
    target.addEventListener(
      "oleafly:proofreading-settings-changed",
      () => void seen.push(grammarSuppressionsFor("p")),
    );
    vi.stubGlobal("window", target);
    try {
      useDictionary.getState().unsuppress("p", "Rule:one");
      useDictionary.getState().clearSuppressed("p");
    } finally {
      vi.stubGlobal("window", undefined);
    }
    expect(seen).toEqual([["Rule:two"], []]);
  });

  it("bumps the revision so a proofreading cache key changes", () => {
    const before = useDictionary.getState().revision;
    suppressGrammarFinding("p", "Rule:one");
    expect(useDictionary.getState().revision).toBeGreaterThan(before);
    ignoreWordForProject("p", "Spanner");
    expect(useDictionary.getState().revision).toBeGreaterThan(before + 1);
  });
});

describe("dictionaryWordFromSelection", () => {
  beforeEach(() => useDictionary.setState(RESET));

  it("strips the punctuation the checkers strip before a lookup", () => {
    expect(dictionaryWordFromSelection("“Spanner”,")).toBe("Spanner");
    expect(dictionaryWordFromSelection("  word.  ")).toBe("word");
  });

  it("keeps the digits that are part of the term", () => {
    expect(dictionaryWordFromSelection("L5")).toBe("L5");
    expect(dictionaryWordFromSelection("(H100)")).toBe("H100");
  });

  it("stores a learned word without its surrounding punctuation", () => {
    ignoreWordForProject("p", "Spanner,");
    expect(useDictionary.getState().ignored.p).toEqual(["Spanner"]);
    expect(isWordIgnored("p", "Spanner")).toBe(true);
  });
});

describe("restoring a decision clears the session entry", () => {
  beforeEach(() => {
    useDictionary.setState({
      ignored: {},
      global: [],
      suppressed: {},
      revision: 0,
    });
    clearWordsIgnoredHere();
  });

  afterEach(() => clearWordsIgnoredHere());

  it("clears the session entry for a word removed from a project", () => {
    ignoreWordHere("p", "main.tex", "Spanner");
    ignoreWordHere("q", "intro.tex", "Spanner");
    ignoreWordHere("p", "main.tex", "Plurdled");
    ignoreWordForProject("p", "Spanner");

    useDictionary.getState().unignore("p", "Spanner");

    expect(isWordIgnoredHere("p", "main.tex", "Spanner")).toBe(false);
    expect(isWordIgnoredHere("q", "intro.tex", "Spanner")).toBe(false);
    expect(isWordIgnoredHere("p", "main.tex", "Plurdled")).toBe(true);
  });

  it("clears the session entry for a word removed from the personal list", () => {
    ignoreWordHere("p", "main.tex", "Spanner");
    ignoreWordGlobally("Spanner");

    useDictionary.getState().unignoreGlobal("Spanner");

    expect(isWordIgnoredHere("p", "main.tex", "Spanner")).toBe(false);
  });

  it("clears the session entry behind a restored finding", () => {
    suppressFindingHere("p", "main.tex", "Rule:abcd1234");
    suppressFindingHere("p", "main.tex", "Rule:99887766");

    useDictionary.getState().unsuppress("p", "Rule:abcd1234");

    expect(isFindingSuppressedHere("p", "main.tex", "Rule:abcd1234")).toBe(
      false,
    );
    expect(isFindingSuppressedHere("p", "main.tex", "Rule:99887766")).toBe(
      true,
    );
  });

  it("clears every session entry behind the findings shown again", () => {
    suppressGrammarFinding("p", "Rule:abcd1234");
    suppressGrammarFinding("p", "Rule:99887766");
    suppressFindingHere("p", "main.tex", "Rule:abcd1234");
    suppressFindingHere("q", "intro.tex", "Rule:99887766");
    suppressFindingHere("p", "main.tex", "Other:55443322");

    useDictionary.getState().clearSuppressed("p");

    expect(isFindingSuppressedHere("p", "main.tex", "Rule:abcd1234")).toBe(
      false,
    );
    expect(isFindingSuppressedHere("q", "intro.tex", "Rule:99887766")).toBe(
      false,
    );
    expect(isFindingSuppressedHere("p", "main.tex", "Other:55443322")).toBe(
      true,
    );
  });

  it("clears every session entry when the dictionary is reset", () => {
    ignoreWordHere("p", "main.tex", "Spanner");
    suppressFindingHere("p", "main.tex", "Rule:abcd1234");

    useDictionary.getState().clearAll();

    expect(isWordIgnoredHere("p", "main.tex", "Spanner")).toBe(false);
    expect(isFindingSuppressedHere("p", "main.tex", "Rule:abcd1234")).toBe(
      false,
    );
  });

  it("clears the session entries for a whole project or personal list", () => {
    ignoreWordHere("p", "main.tex", "Spanner");
    ignoreWordHere("p", "main.tex", "Plurdled");
    ignoreWordForProject("p", "Spanner");
    ignoreWordGlobally("Plurdled");

    useDictionary.getState().clear("p");
    expect(isWordIgnoredHere("p", "main.tex", "Spanner")).toBe(false);
    expect(isWordIgnoredHere("p", "main.tex", "Plurdled")).toBe(true);

    useDictionary.getState().clearGlobal();
    expect(isWordIgnoredHere("p", "main.tex", "Plurdled")).toBe(false);
  });
});
