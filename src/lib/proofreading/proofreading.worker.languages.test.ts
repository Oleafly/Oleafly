// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  PROOFREADING_PROTOCOL_VERSION,
  type ProofreadingRequest,
  type ProofreadingResult,
  type ProofreadingSuggestResult,
} from "@oleafly/editor";

const postMessage = vi.fn();
let nextId = 0;

function deliver(locale: string) {
  const file = (extension: string) =>
    new Uint8Array(
      readFileSync(
        path.join(process.cwd(), "public/dictionaries", `${locale}.${extension}`),
      ),
    );
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        protocolVersion: PROOFREADING_PROTOCOL_VERSION,
        type: "dictionary",
        locale,
        aff: file("aff"),
        dic: file("dic"),
      },
    }),
  );
}

function responseFor(requestId: number) {
  return postMessage.mock.calls.find(
    ([response]) => response.requestId === requestId,
  )?.[0];
}

async function spell(
  locale: string,
  text: string,
  format: ProofreadingRequest["format"] = "latex",
): Promise<ProofreadingResult> {
  const id = ++nextId;
  const request: ProofreadingRequest = {
    protocolVersion: PROOFREADING_PROTOCOL_VERSION,
    type: "proofread",
    requestId: id,
    identity: {
      projectId: "project",
      path: `doc-${id}.tex`,
      revision: id,
      requestGeneration: id,
      surface: "source",
    },
    format,
    mode: "spelling",
    text,
    ignoredWords: [],
    suppressions: [],
    preferences: {
      showRegionalism: true,
      showWordChoice: true,
      dialect: "american",
      dictionaryLocale: locale,
    },
  };
  window.dispatchEvent(new MessageEvent("message", { data: request }));
  await vi.waitFor(() => expect(responseFor(id)).toBeDefined(), {
    timeout: 20_000,
  });
  const response = responseFor(id);
  expect(response.type).toBe("result");
  return response as ProofreadingResult;
}

async function suggest(locale: string, word: string) {
  const id = ++nextId;
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        protocolVersion: PROOFREADING_PROTOCOL_VERSION,
        type: "suggest",
        requestId: id,
        locale,
        word,
      },
    }),
  );
  await vi.waitFor(() => expect(responseFor(id)).toBeDefined(), {
    timeout: 20_000,
  });
  return responseFor(id) as ProofreadingSuggestResult;
}

const flagged = (result: ProofreadingResult) =>
  result.diagnostics.map((diagnostic) => diagnostic.word);

beforeAll(async () => {
  vi.stubGlobal("postMessage", postMessage);
  await import("./proofreading.worker");
  deliver("de_DE");
  deliver("fr_FR");
}, 30_000);

describe("spelling with the real dictionaries", () => {
  it("accepts German words with umlauts and ß", async () => {
    const result = await spell(
      "de_DE",
      String.raw`\section{Einführung}
Die Größe der Straße überrascht die Bürger. Übungen für Schüler sind schön.`,
    );
    expect(flagged(result)).toEqual([]);
  }, 30_000);

  it("flags a real German typo as one whole word", async () => {
    const result = await spell("de_DE", "Die Grösse der Strasse überrascht die Bürgr.");
    expect(flagged(result)).toContain("Bürgr");
    expect(flagged(result).every((word) => word.length > 2)).toBe(true);
  }, 30_000);

  it("accepts French elisions with either apostrophe", async () => {
    const result = await spell(
      "fr_FR",
      "Aujourd’hui, l’homme qu’il connaît est là. Aujourd'hui, l'homme est déçu.",
    );
    expect(flagged(result)).toEqual([]);
  }, 30_000);

  it("finishes a French document full of typos without computing every suggestion", async () => {
    const typos = Array.from(
      { length: 40 },
      (_, index) => `mauvai${"abcdefghijklmnopqrst"[index % 20]}${"xyz"[index % 3]}se`,
    );
    const result = await spell(
      "fr_FR",
      `La phrase ${typos.join(" et ")} est déçue.`,
    );

    expect(result.status).toBe("ready");
    expect(new Set(flagged(result))).toEqual(new Set(typos));
    const deferred = result.diagnostics.filter(
      (diagnostic) => diagnostic.suggestionsDeferred,
    );
    expect(deferred.length).toBeGreaterThan(0);
    expect(
      result.diagnostics
        .filter((diagnostic) => !diagnostic.suggestionsDeferred)
        .every((diagnostic) => Array.isArray(diagnostic.suggestions)),
    ).toBe(true);

    const answer = await suggest("fr_FR", "bonjuor");
    expect(answer.suggestions.map((suggestion) => suggestion.text)).toContain(
      "bonjour",
    );
  }, 60_000);

  it("keeps English possessives and LaTeX quotes clean", async () => {
    deliver("en_US");
    const result = await spell(
      "en_US",
      "The students' results were ``well-known'' and don’t surprise anyone.",
    );
    expect(flagged(result)).toEqual([]);
  }, 30_000);
});
