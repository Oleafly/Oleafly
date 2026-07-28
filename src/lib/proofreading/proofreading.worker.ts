import type {
  Dialect,
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
const MAX_QUEUED_LANES = 4;
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
  return {
    protocolVersion: PROOFREADING_PROTOCOL_VERSION,
    type: "error",
    requestId: request.requestId,
    identity: request.identity,
    error: { code, message, retryable },
  };
}

function resultResponse(
  request: ProofreadingRequest,
  status: ProofreadingResult["status"],
  diagnostics: ProofreadingDiagnostic[],
  options: { message?: string; truncated?: boolean } = {},
): ProofreadingResult {
  return {
    protocolVersion: PROOFREADING_PROTOCOL_VERSION,
    type: "result",
    requestId: request.requestId,
    identity: request.identity,
    status,
    diagnostics,
    ...options,
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
    (request.mode !== "grammar" && request.mode !== "spelling") ||
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
  const dialectValues: Record<ProofreadingDialect, Dialect> = {
    american: grammarDialectValues.American,
    british: grammarDialectValues.British,
    australian: grammarDialectValues.Australian,
    canadian: grammarDialectValues.Canadian,
    indian: grammarDialectValues.Indian,
  };
  await linter.setDialect(dialectValues[dialect]);
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
  const safeLocale = /^[A-Za-z]{2,3}(?:[_-][A-Za-z]{2,4})?$/u.test(locale)
    ? locale.replace("-", "_")
    : "en_US";
  if (!spellcheckerPromise || spellcheckerLocale !== safeLocale) {
    spellcheckerLocale = safeLocale;
    spellcheckerPromise = (async () => {
      // hunspell-asm 4's embedded Emscripten runtime detects workers via the
      // classic-worker `importScripts` global. Oleafly uses an ES-module
      // worker, where that global is absent even though every API Hunspell
      // needs (WASM, XHR, timers, typed arrays) is available. A non-loading
      // compatibility marker selects the correct worker branch; no script can
      // be imported through it.
      const workerGlobals = globalThis as typeof globalThis & {
        importScripts?: (...urls: string[]) => void;
      };
      if (typeof workerGlobals.importScripts !== "function") {
        Object.defineProperty(workerGlobals, "importScripts", {
          configurable: true,
          value: () => {
            throw new Error(
              "Dynamic script loading is disabled in the proofreading worker.",
            );
          },
        });
      }
      const { loadModule } = await import("hunspell-asm");
      const factory = await loadModule();
      const dictionaryBase =
        workerScope.location.origin &&
        workerScope.location.origin !== "null"
          ? `${workerScope.location.origin}/`
          : workerScope.location.href;
      const dictionaryUrl = (name: string) =>
        new URL(`/dictionaries/${name}`, dictionaryBase);
      const loadPack = async (name: string) => {
        const [affResponse, dictionaryResponse] = await Promise.all([
          fetch(dictionaryUrl(`${name}.aff`)),
          fetch(dictionaryUrl(`${name}.dic`)),
        ]);
        return affResponse.ok && dictionaryResponse.ok
          ? { affResponse, dictionaryResponse, name }
          : null;
      };
      const pack = (await loadPack(safeLocale)) ?? (await loadPack("en_US"));
      if (!pack) throw new Error("Dictionary assets are unavailable.");
      const { affResponse, dictionaryResponse, name } = pack;
      if (!affResponse.ok || !dictionaryResponse.ok) {
        throw new Error("Dictionary assets are unavailable.");
      }
      const [aff, dictionary] = await Promise.all([
        affResponse.arrayBuffer(),
        dictionaryResponse.arrayBuffer(),
      ]);
      const affPath = factory.mountBuffer(
        new Uint8Array(aff),
        `${name}.aff`,
      );
      const dictionaryPath = factory.mountBuffer(
        new Uint8Array(dictionary),
        `${name}.dic`,
      );
      return factory.create(affPath, dictionaryPath);
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
): Promise<ProofreadingDiagnostic[]> {
  const { prose, map } = proseFor(request);
  if (!prose) return [];
  const linter = await getGrammarLinter();
  await syncGrammarDialect(linter, request.preferences.dialect);
  await syncGrammarDictionary(linter, ignored);
  const lints = await linter.lint(prose, {
    language: "plaintext",
  });
  const diagnostics: ProofreadingDiagnostic[] = [];
  for (const lint of lints) {
    let span: Span | null = null;
    let suggestions: Suggestion[] = [];
    try {
      if (diagnostics.length >= PROOFREADING_LIMITS.diagnostics) {
        continue;
      }
      span = lint.span();
      const proseFrom = Math.max(0, Math.min(span.start, prose.length));
      const proseTo = Math.max(
        proseFrom + 1,
        Math.min(span.end, prose.length),
      );
      if (proseFrom >= map.length) continue;
      const from = map[proseFrom];
      const to = (map[Math.min(proseTo, map.length) - 1] ?? from) + 1;
      if (to <= from || to > request.text.length) continue;
      const kind = lint.lint_kind();
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
      // A malformed lint must not discard other valid diagnostics.
    } finally {
      freeHarperObjects(lint, span, suggestions);
    }
  }
  return diagnostics;
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
    if (diagnostics.length >= PROOFREADING_LIMITS.diagnostics) break;
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
    request.mode === "grammar"
      ? PROOFREADING_LIMITS.grammarCharacters
      : PROOFREADING_LIMITS.spellingCharacters;
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
      truncated: cached.length >= PROOFREADING_LIMITS.diagnostics,
    });
  }

  try {
    const ignored = new Set(normalizedIgnored);
    const diagnostics =
      request.mode === "grammar"
        ? await grammarDiagnostics(request, ignored)
        : await spellingDiagnostics(request, ignored);
    writeCache(key, request.text, ignoredKey, diagnostics);
    return resultResponse(request, "ready", diagnostics, {
      truncated: diagnostics.length >= PROOFREADING_LIMITS.diagnostics,
    });
  } catch {
    return errorResponse(
      request,
      "initialization_failed",
      request.mode === "grammar"
        ? "The offline grammar engine could not start."
        : "The offline spelling dictionary could not start.",
      true,
    );
  }
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
  while (queuedRequests.size > MAX_QUEUED_LANES) {
    const oldestLane = queuedRequests.keys().next().value as
      | string
      | undefined;
    if (!oldestLane) break;
    queuedRequests.delete(oldestLane);
    latestGeneration.delete(oldestLane);
  }
  void drainQueue();
});
