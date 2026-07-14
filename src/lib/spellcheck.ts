// hunspell-asm is imported lazily so its ~780KB embedded WASM lives in a
// separate chunk, loaded only when spellcheck first runs.
type HunspellFactory = Awaited<ReturnType<typeof import("hunspell-asm")["loadModule"]>>;
type Hunspell = ReturnType<HunspellFactory["create"]>;

let factoryPromise: Promise<HunspellFactory> | null = null;
let readyPromise: Promise<Hunspell> | null = null;

const IGNORE = new Set([
  "tex", "latex", "pdflatex", "xelatex", "xetex", "luatex", "bibtex",
  "tectonic", "begin", "end", "item", "href", "url", "pdf", "ieee",
  "inline", "argv", "stdin", "stdout", "backend", "frontend", "api",
  "config", "filename", "localhost", "boolean", "string", "enum",
]);

async function getFactory(): Promise<HunspellFactory> {
  if (!factoryPromise) {
    const { loadModule } = await import("hunspell-asm");
    factoryPromise = loadModule();
  }
  return factoryPromise;
}

export function getSpellchecker(): Promise<Hunspell> {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    const factory = await getFactory();
    const [affRes, dicRes] = await Promise.all([
      fetch("dictionaries/en_US.aff"),
      fetch("dictionaries/en_US.dic"),
    ]);
    if (!affRes.ok || !dicRes.ok) throw new Error("failed to load dictionaries");
    const [aff, dic] = await Promise.all([affRes.arrayBuffer(), dicRes.arrayBuffer()]);
    const affPath = factory.mountBuffer(new Uint8Array(aff), "en_US.aff");
    const dicPath = factory.mountBuffer(new Uint8Array(dic), "en_US.dic");
    return factory.create(affPath, dicPath);
  })();
  // Reset on failure so a later call retries instead of returning the cached
  // rejection forever (mirrors harper.ts). Without this a transient dictionary
  // fetch failure would disable spellcheck until the app restarts.
  readyPromise.catch(() => {
    readyPromise = null;
  });
  return readyPromise;
}

export function isIgnored(word: string): boolean {
  const w = word.toLowerCase();
  if (IGNORE.has(w)) return true;
  if (/^\d+$/.test(word)) return true;
  // ALL_CAPS acronyms (>=2 chars) and tokens with digits are fine.
  if (/[0-9]/.test(word)) return true;
  if (word.length >= 2 && word === word.toUpperCase() && /[A-Z]/.test(word)) return true;
  return false;
}
