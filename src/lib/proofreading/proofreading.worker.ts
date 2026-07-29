import type {
  LocalLinter,
  Lint,
  Span,
  Suggestion,
} from "harper.js";
import type { Hunspell } from "hunspell-asm";
import {
  PROOFREADING_LIMITS,
  PROOFREADING_PROTOCOL_VERSION,
  type ProofreadingDialect,
  type ProofreadingDiagnostic,
  type ProofreadingError,
  type ProofreadingIdentity,
  type ProofreadingRequest,
  type ProofreadingResult,
  type ProofreadingSuggestion,
  type ProofreadingWorkerRequest,
  type ProofreadingWorkerResponse,
} from "../../../packages/editor/src/proofreading";
import {
  maskToProse,
  spellcheckRanges,
} from "../../../packages/editor/src/latex-mask";
import {
  markdownSpellcheckRanges,
  markdownToProse,
} from "../../../packages/editor/src/markdown-mask";
import {
  typstSpellcheckRanges,
  typstToProse,
} from "../../../packages/editor/src/typst-mask";
import {
  BUILTIN_PROOFREADING_WORDS,
  isSessionIgnoredWord,
} from "./ignored";
import { harperDialectFor } from "./dialects";
import { loadHunspellDictionary } from "./hunspell";

interface WorkerScope {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  postMessage(message: ProofreadingWorkerResponse): void;
  close(): void;
  location: Location;
}

interface CachedResult {
  key: string;
  text: string;
  ignored: string;
  diagnostics: ProofreadingDiagnostic[];
  characters: number;
}

type WordRange = { from: number; to: number; word: string };

const workerScope = self as unknown as WorkerScope;
const MAX_CACHE_ENTRIES = 8;
const MAX_CACHE_CHARACTERS = 600_000;
const cache = new Map<string, CachedResult>();
let cachedCharacters = 0;
let grammarPromise: Promise<LocalLinter> | null = null;
let grammarDictionaryKey: string | null = null;
let grammarDialect: ProofreadingDialect | null = null;
let grammarDialectValues: typeof import("harper.js").Dialect | null = null;
let spellcheckerPromise: Promise<Hunspell> | null = null;
let spellcheckerLocale = "en_US";
const queuedRequests = new Map<string, ProofreadingRequest>();
let running = false;
let disposed = false;
const latestGeneration = new Map<string, number>();

function lane(identity: ProofreadingIdentity): string {
  return `${identity.surface}\0${identity.projectId ?? ""}\0${identity.path}`;
}

function normalizeWord(word: string): string {
  return word.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function isIgnoredToken(word: string, ignored: ReadonlySet<string>): boolean {
  const normalized = normalizeWord(word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ""));
  if (!normalized) return true;
  return ignored.has(normalized) || isSessionIgnoredWord(word);
}

function identityIsLatest(identity: ProofreadingIdentity): boolean {
  return (
    latestGeneration.get(lane(identity)) === identity.requestGeneration
  );
}

function errorResponse(
  request: ProofreadingRequest,
  code: ProofreadingError["error"]["code"],
  message: string,
  retryable: boolean,
): ProofreadingError {
  const safeMessage =
    message.length > 1_024
      ? `${message.slice(0, 1_023)}…`
      : message;
  return {
    protocolVersion: PROOFREADING_PROTOCOL_VERSION,
    type: "error",
    requestId: request.requestId,
    identity: request.identity,
    error: { code, message: safeMessage, retryable },
  };
}

function resultResponse(
  request: ProofreadingRequest,
  status: ProofreadingResult["status"],
  diagnostics: ProofreadingDiagnostic[],
  options: {
    message?: string;
    activeDictionaryLocale?: string;
    truncated?: boolean;
  } = {},
): ProofreadingResult {
  const message =
    options.message && options.message.length > 2_048
      ? `${options.message.slice(0, 2_047)}…`
      : options.message;
  return {
    protocolVersion: PROOFREADING_PROTOCOL_VERSION,
    type: "result",
    requestId: request.requestId,
    identity: request.identity,
    status,
    diagnostics,
    ...options,
    ...(message ? { message } : {}),
  };
}

function validateRequest(request: ProofreadingRequest): string | null {
  if (
    request.protocolVersion !== PROOFREADING_PROTOCOL_VERSION ||
    request.type !== "proofread" ||
    !Number.isSafeInteger(request.requestId) ||
    request.requestId <= 0
  ) {
    return "Malformed proofreading request.";
  }
  const { identity } = request;
  if (
    (typeof identity.projectId !== "string" &&
      identity.projectId !== null) ||
    (typeof identity.projectId === "string" &&
      identity.projectId.length > 256) ||
    typeof identity.path !== "string" ||
    identity.path.length > 2_048 ||
    !Number.isSafeInteger(identity.revision) ||
    identity.revision < 0 ||
    !Number.isSafeInteger(identity.requestGeneration) ||
    identity.requestGeneration <= 0 ||
    (identity.surface !== "source" && identity.surface !== "visual")
  ) {
    return "Malformed proofreading identity.";
  }
  if (
    !["latex", "markdown", "plaintext", "typst"].includes(
      request.format,
    ) ||
    !["grammar", "spelling", "combined"].includes(request.mode) ||
    typeof request.text !== "string" ||
    !Array.isArray(request.ignoredWords) ||
    request.ignoredWords.length > PROOFREADING_LIMITS.ignoredWords ||
    request.ignoredWords.some(
      (word) =>
        typeof word !== "string" ||
        word.length > PROOFREADING_LIMITS.wordCharacters,
    ) ||
    typeof request.preferences !== "object" ||
    request.preferences === null ||
    typeof request.preferences.showRegionalism !== "boolean" ||
    typeof request.preferences.showWordChoice !== "boolean" ||
    (request.preferences.dictionaryLocale !== undefined &&
      (typeof request.preferences.dictionaryLocale !== "string" ||
        !/^[A-Za-z]{2,3}(?:[_-][A-Za-z]{2,4})?$/u.test(
          request.preferences.dictionaryLocale,
        ))) ||
    ![
      "american",
      "british",
      "australian",
      "canadian",
      "indian",
    ].includes(request.preferences.dialect)
  ) {
    return "Malformed proofreading input.";
  }
  return null;
}

function compactMasked(masked: string): { prose: string; map: number[] } {
  let prose = "";
  const map: number[] = [];
  let pendingSpaceAt = -1;
  for (let index = 0; index < masked.length; index++) {
    const character = masked[index];
    if (/\s/u.test(character)) {
      if (prose.length > 0) pendingSpaceAt = index;
      continue;
    }
    if (pendingSpaceAt >= 0) {
      if (!/[.,:;!?)}\]'’]/u.test(character)) {
        prose += " ";
        map.push(pendingSpaceAt);
      }
      pendingSpaceAt = -1;
    }
    prose += character;
    map.push(index);
  }
  return { prose, map };
}

function plaintextToProse(text: string): {
  prose: string;
  map: number[];
} {
  const characters = text.split("");
  const patterns = [
    /(?:https?:\/\/|www\.)[^\s<>()]+/giu,
    /\b[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}\b/giu,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined) continue;
      for (
        let index = match.index;
        index < match.index + match[0].length;
        index++
      ) {
        if (characters[index] !== "\n") characters[index] = " ";
      }
    }
  }
  return compactMasked(characters.join(""));
}

function proseFor(request: ProofreadingRequest): {
  prose: string;
  map: number[];
} {
  if (request.format === "latex") return maskToProse(request.text);
  if (request.format === "typst") return typstToProse(request.text);
  if (request.format === "markdown") {
    return markdownToProse(request.text);
  }
  return plaintextToProse(request.text);
}

function spellingRanges(request: ProofreadingRequest): WordRange[] {
  if (request.format === "latex") {
    return spellcheckRanges(request.text);
  }
  if (request.format === "markdown") {
    return markdownSpellcheckRanges(request.text);
  }
  if (request.format === "typst") {
    return typstSpellcheckRanges(request.text);
  }
  const { prose, map } = plaintextToProse(request.text);
  const ranges: WordRange[] = [];
  for (const match of prose.matchAll(/\p{L}[\p{L}'’]*/gu)) {
    if (match.index === undefined || match[0].length < 2) continue;
    const from = map[match.index];
    const to = (map[match.index + match[0].length - 1] ?? from) + 1;
    ranges.push({ from, to, word: request.text.slice(from, to) });
  }
  return ranges;
}

async function getGrammarLinter(): Promise<LocalLinter> {
  if (!grammarPromise) {
    grammarPromise = (async () => {
      const [{ Dialect, LocalLinter }, { binary }] = await Promise.all([
        import("harper.js"),
        import("harper.js/binary"),
      ]);
      grammarDialectValues = Dialect;
      const linter: LocalLinter = new LocalLinter({ binary });
      await linter.setup();
      await linter.setLintConfig({
        Spaces: false,
        NoFrenchSpaces: false,
        TransposedSpace: false,
      });
      await linter.setDialect(Dialect.American);
      grammarDialect = "american";
      return linter;
    })();
    grammarPromise.catch(() => {
      grammarPromise = null;
      grammarDictionaryKey = null;
      grammarDialect = null;
      grammarDialectValues = null;
    });
  }
  return grammarPromise;
}

async function syncGrammarDialect(
  linter: LocalLinter,
  dialect: ProofreadingDialect,
) {
  if (dialect === grammarDialect) return;
  if (!grammarDialectValues) {
    throw new Error("Harper dialects are unavailable.");
  }
  await linter.setDialect(
    harperDialectFor(grammarDialectValues, dialect),
  );
  grammarDialect = dialect;
  // Be conservative if Harper rebuilds its lexicon while changing dialect.
  grammarDictionaryKey = null;
}

async function syncGrammarDictionary(
  linter: LocalLinter,
  ignored: ReadonlySet<string>,
) {
  const words = [
    ...new Set([...BUILTIN_PROOFREADING_WORDS, ...ignored]),
  ]
    .filter((word) => /^[\p{L}'’-]+$/u.test(word))
    .sort();
  const key = words.join("\0");
  if (key === grammarDictionaryKey) return;
  try {
    await linter.clearWords();
    await linter.importWords(words);
    grammarDictionaryKey = key;
  } catch {
    // Exact diagnostic filtering remains authoritative if Harper cannot
    // import its optional inflection-aware dictionary.
    grammarDictionaryKey = null;
  }
}

async function getSpellchecker(locale = "en_US"): Promise<Hunspell> {
  const safeLocale = locale.replace("-", "_");
  if (!spellcheckerPromise || spellcheckerLocale !== safeLocale) {
    const previous = spellcheckerPromise;
    spellcheckerLocale = safeLocale;
    spellcheckerPromise = (async () => {
      if (previous) {
        const previousSpellchecker = await previous.catch(() => null);
        previousSpellchecker?.dispose();
      }
      return loadHunspellDictionary(safeLocale);
    })();
    spellcheckerPromise.catch(() => {
      spellcheckerPromise = null;
    });
  }
  return spellcheckerPromise;
}

function mapSuggestionKind(value: number): 0 | 1 | 2 {
  return value === 1 ? 1 : value === 2 ? 2 : 0;
}

function freeHarperObjects(
  lint: Lint,
  span: Span | null,
  suggestions: Suggestion[],
) {
  for (const suggestion of suggestions) {
    try {
      suggestion.free();
    } catch {
      // The WASM object may already have been released.
    }
  }
  try {
    span?.free();
  } catch {
    // The WASM object may already have been released.
  }
  try {
    lint.free();
  } catch {
    // The WASM object may already have been released.
  }
}

async function grammarDiagnostics(
  request: ProofreadingRequest,
  ignored: ReadonlySet<string>,
): Promise<{
  diagnostics: ProofreadingDiagnostic[];
  malformedLintCount: number;
}> {
  const { prose, map } = proseFor(request);
  if (!prose) return { diagnostics: [], malformedLintCount: 0 };
  const linter = await getGrammarLinter();
  await syncGrammarDialect(linter, request.preferences.dialect);
  await syncGrammarDictionary(linter, ignored);
  const lints = await linter.lint(prose, {
    language: "plaintext",
  });
  const diagnostics: ProofreadingDiagnostic[] = [];
  let malformedLintCount = 0;
  for (const lint of lints) {
    let span: Span | null = null;
    let suggestions: Suggestion[] = [];
    try {
      span = lint.span();
      const proseFrom = Math.max(0, Math.min(span.start, prose.length));
      const proseTo = Math.max(
        proseFrom + 1,
        Math.min(span.end, prose.length),
      );
      if (proseFrom >= map.length) {
        malformedLintCount += 1;
        continue;
      }
      const from = map[proseFrom];
      const to = (map[Math.min(proseTo, map.length) - 1] ?? from) + 1;
      if (to <= from || to > request.text.length) {
        malformedLintCount += 1;
        continue;
      }
      const kind = lint.lint_kind();
      // Harper classifies dialect mismatches such as colour/color as
      // "Spelling". Preserve those findings in Harper-only mode so the
      // selected English dialect and Regionalism setting have an observable
      // effect. In combined mode Hunspell remains the spelling authority,
      // avoiding duplicate findings and respecting its selected locale.
      if (
        kind === "Spelling" &&
        (request.mode !== "grammar" ||
          !request.preferences.showRegionalism)
      ) {
        continue;
      }
      if (
        (!request.preferences.showRegionalism &&
          /regional/iu.test(kind)) ||
        (!request.preferences.showWordChoice &&
          /word.?choice/iu.test(kind))
      ) {
        continue;
      }
      const word = request.text.slice(from, to);
      if (isIgnoredToken(word, ignored)) continue;
      suggestions = lint.suggestions();
      const mappedSuggestions: ProofreadingSuggestion[] = [];
      for (const suggestion of suggestions.slice(0, 8)) {
        const suggestionKind = mapSuggestionKind(suggestion.kind());
        const text = suggestion.get_replacement_text();
        if (!text && suggestionKind !== 1) continue;
        mappedSuggestions.push({ text, kind: suggestionKind });
      }
      diagnostics.push({
        from,
        to,
        message: lint.message(),
        kind,
        source: "harper",
        word,
        suggestions: mappedSuggestions,
      });
    } catch {
      // Retain other valid diagnostics, but report the incomplete analysis to
      // the UI instead of silently claiming a fully successful pass.
      malformedLintCount += 1;
    } finally {
      freeHarperObjects(lint, span, suggestions);
    }
  }
  return { diagnostics, malformedLintCount };
}

async function spellingDiagnostics(
  request: ProofreadingRequest,
  ignored: ReadonlySet<string>,
): Promise<ProofreadingDiagnostic[]> {
  const spellchecker = await getSpellchecker(request.preferences.dictionaryLocale);
  const diagnostics: ProofreadingDiagnostic[] = [];
  for (const range of spellingRanges(request)) {
    if (
      range.word.length < 2 ||
      range.word.length > PROOFREADING_LIMITS.wordCharacters ||
      isIgnoredToken(range.word, ignored) ||
      spellchecker.spell(range.word)
    ) {
      continue;
    }
    const suggestions = spellchecker
      .suggest(range.word)
      .slice(0, 8)
      .filter((text) => text.length > 0)
      .map<ProofreadingSuggestion>((text) => ({ text, kind: 0 }));
    diagnostics.push({
      from: range.from,
      to: range.to,
      message: `Possible misspelling: “${range.word}”`,
      kind: "Spelling",
      source: "hunspell",
      word: range.word,
      suggestions,
    });
  }
  return diagnostics;
}

function fingerprint(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function cacheKey(request: ProofreadingRequest, ignored: string): string {
  return [
    request.mode,
    request.format,
    request.preferences.dialect,
    request.preferences.dictionaryLocale?.replace("-", "_") ?? "",
    request.preferences.showRegionalism ? "r1" : "r0",
    request.preferences.showWordChoice ? "w1" : "w0",
    request.text.length,
    fingerprint(request.text),
    fingerprint(ignored),
  ].join(":");
}

function readCache(
  key: string,
  text: string,
  ignored: string,
): ProofreadingDiagnostic[] | null {
  const cached = cache.get(key);
  if (!cached || cached.text !== text || cached.ignored !== ignored) {
    return null;
  }
  cache.delete(key);
  cache.set(key, cached);
  return cached.diagnostics;
}

function writeCache(
  key: string,
  text: string,
  ignored: string,
  diagnostics: ProofreadingDiagnostic[],
) {
  const existing = cache.get(key);
  if (existing) {
    cachedCharacters -= existing.characters;
    cache.delete(key);
  }
  const cached: CachedResult = {
    key,
    text,
    ignored,
    diagnostics,
    characters: text.length,
  };
  cache.set(key, cached);
  cachedCharacters += cached.characters;
  while (
    cache.size > MAX_CACHE_ENTRIES ||
    cachedCharacters > MAX_CACHE_CHARACTERS
  ) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    const oldest = cache.get(oldestKey);
    cache.delete(oldestKey);
    cachedCharacters -= oldest?.characters ?? 0;
  }
}

async function analyze(
  request: ProofreadingRequest,
): Promise<ProofreadingResult | ProofreadingError> {
  const validationFailure = validateRequest(request);
  if (validationFailure) {
    return errorResponse(
      request,
      "invalid_request",
      validationFailure,
      false,
    );
  }
  const limit =
    request.mode === "spelling"
      ? PROOFREADING_LIMITS.spellingCharacters
      : request.mode === "grammar"
      ? PROOFREADING_LIMITS.grammarCharacters
      : Math.min(
          PROOFREADING_LIMITS.grammarCharacters,
          PROOFREADING_LIMITS.spellingCharacters,
        );
  if (request.text.length > limit) {
    return resultResponse(request, "too_large", [], {
      message: `Proofreading paused for this ${request.text.length.toLocaleString()}-character document (limit ${limit.toLocaleString()}).`,
    });
  }

  const normalizedIgnored = [
    ...new Set(request.ignoredWords.map(normalizeWord).filter(Boolean)),
  ].sort();
  const ignoredKey = normalizedIgnored.join("\0");
  const key = cacheKey(request, ignoredKey);
  const cached = readCache(key, request.text, ignoredKey);
  if (cached) {
    return resultResponse(request, "ready", cached, {
      ...(request.mode !== "grammar"
        ? {
            activeDictionaryLocale:
              request.preferences.dictionaryLocale?.replace("-", "_") ??
              "en_US",
          }
        : {}),
    });
  }

  const ignored = new Set(normalizedIgnored);
  if (request.mode === "grammar") {
    try {
      const grammar = await grammarDiagnostics(request, ignored);
      if (grammar.malformedLintCount > 0) {
        return resultResponse(request, "partial", grammar.diagnostics, {
          message: `${grammar.malformedLintCount.toLocaleString()} malformed grammar finding${grammar.malformedLintCount === 1 ? " was" : "s were"} skipped; all valid findings are shown.`,
        });
      }
      writeCache(
        key,
        request.text,
        ignoredKey,
        grammar.diagnostics,
      );
      return resultResponse(request, "ready", grammar.diagnostics);
    } catch (error) {
      return errorResponse(
        request,
        "analysis_failed",
        error instanceof Error
          ? `Grammar checking failed: ${error.message}`
          : "Grammar checking could not finish.",
        true,
      );
    }
  }

  if (request.mode === "spelling") {
    try {
      const diagnostics = await spellingDiagnostics(request, ignored);
      writeCache(key, request.text, ignoredKey, diagnostics);
      return resultResponse(request, "ready", diagnostics, {
        activeDictionaryLocale:
          request.preferences.dictionaryLocale?.replace("-", "_") ??
          "en_US",
      });
    } catch (error) {
      return errorResponse(
        request,
        "initialization_failed",
        error instanceof Error
          ? error.message
          : `The requested ${
              request.preferences.dictionaryLocale ?? "en_US"
            } spelling dictionary could not start.`,
        true,
      );
    }
  }

  const [grammarResult, spellingResult] = await Promise.allSettled([
    grammarDiagnostics(request, ignored),
    spellingDiagnostics(request, ignored),
  ]);
  if (
    grammarResult.status === "rejected" &&
    spellingResult.status === "rejected"
  ) {
    return errorResponse(
      request,
      "analysis_failed",
      "Grammar and spelling checking could not finish.",
      true,
    );
  }
  const diagnostics = [
    ...(grammarResult.status === "fulfilled"
      ? grammarResult.value.diagnostics
      : []),
    ...(spellingResult.status === "fulfilled"
      ? spellingResult.value
      : []),
  ].sort(
    (left, right) =>
      left.from - right.from ||
      left.to - right.to ||
      left.source.localeCompare(right.source),
  );
  const malformedLintCount =
    grammarResult.status === "fulfilled"
      ? grammarResult.value.malformedLintCount
      : 0;
  const partialReasons: string[] = [];
  if (grammarResult.status === "rejected") {
    partialReasons.push("grammar checking did not finish");
  }
  if (spellingResult.status === "rejected") {
    partialReasons.push(
      `the requested ${
        request.preferences.dictionaryLocale ?? "en_US"
      } spelling dictionary could not start`,
    );
  }
  if (malformedLintCount > 0) {
    partialReasons.push(
      `${malformedLintCount.toLocaleString()} malformed grammar finding${malformedLintCount === 1 ? " was" : "s were"} skipped`,
    );
  }
  if (partialReasons.length > 0) {
    return resultResponse(request, "partial", diagnostics, {
      message: `Partial proofreading: ${partialReasons.join("; ")}. Valid findings are still shown.`,
      ...(spellingResult.status === "fulfilled"
        ? {
            activeDictionaryLocale:
              request.preferences.dictionaryLocale?.replace("-", "_") ??
              "en_US",
          }
        : {}),
    });
  }
  writeCache(key, request.text, ignoredKey, diagnostics);
  return resultResponse(request, "ready", diagnostics, {
    activeDictionaryLocale:
      request.preferences.dictionaryLocale?.replace("-", "_") ??
      "en_US",
  });
}

async function drainQueue() {
  if (running || disposed) return;
  running = true;
  try {
    while (queuedRequests.size > 0 && !disposed) {
      const queued = queuedRequests.entries().next().value as
        | [string, ProofreadingRequest]
        | undefined;
      if (!queued) break;
      const [requestLane, request] = queued;
      queuedRequests.delete(requestLane);
      const response = await analyze(request);
      if (identityIsLatest(request.identity) && !disposed) {
        workerScope.postMessage(response);
        if (
          latestGeneration.get(requestLane) ===
          request.identity.requestGeneration
        ) {
          latestGeneration.delete(requestLane);
        }
      }
    }
  } finally {
    running = false;
  }
}

workerScope.addEventListener("message", (event) => {
  const message = event.data as Partial<ProofreadingWorkerRequest> | null;
  if (
    message?.protocolVersion !== PROOFREADING_PROTOCOL_VERSION ||
    disposed
  ) {
    return;
  }
  if (message.type === "dispose") {
    disposed = true;
    queuedRequests.clear();
    latestGeneration.clear();
    cache.clear();
    cachedCharacters = 0;
    spellcheckerPromise?.then((spellchecker) => spellchecker.dispose()).catch(
      () => {
        // Worker termination is authoritative.
      },
    );
    grammarPromise?.then((linter) => linter.dispose()).catch(() => {
      // Worker termination is authoritative.
    });
    workerScope.close();
    return;
  }
  if (message.type !== "proofread") return;
  const request = message as ProofreadingRequest;
  latestGeneration.set(
    lane(request.identity),
    request.identity.requestGeneration,
  );
  const requestLane = lane(request.identity);
  queuedRequests.delete(requestLane);
  queuedRequests.set(requestLane, request);
  void drainQueue();
});
