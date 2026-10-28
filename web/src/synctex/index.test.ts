import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import type { SynctexForwardHit, SynctexHit } from "@oleafly/backend-port";
import { beforeAll, describe, expect, it } from "vitest";
import { createSyncTexModule, type SyncTexExports } from "./engine";
import { loadSyncTex, SYNCTEX_WASM_URL, type SyncTexModule, SyncTexError } from "./index";

// The golden files hold the desktop's answers, written by the native search
// in crates/oleafly-doctools/tests/synctex_golden.rs; the floats in them are
// exact, so the module has to match them exactly.
interface Golden {
  fixture: string;
  roots: string[];
  projectPaths: string[];
  forward: { file: string; line: number; hit: SynctexForwardHit | null }[];
  inverse: { page: number; x: number; y: number; hit: SynctexHit | null }[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, "../../../crates/oleafly-synctex/tests/fixtures/synctex");
const wasm = readFileSync(path.join(here, "oleafly_synctex.wasm"));
const goldens: Golden[] = readdirSync(fixtures)
  .filter((name) => name.endsWith(".expected.json"))
  .sort()
  .map((name) => JSON.parse(readFileSync(path.join(fixtures, name), "utf8")) as Golden);
const gz = (golden: Golden) => new Uint8Array(readFileSync(path.join(fixtures, golden.fixture)));

/** The same output as if it had been compiled in `root` instead. */
function movedTo(golden: Golden, root: string): Uint8Array {
  const text = gunzipSync(gz(golden)).toString("utf8");
  const moved = text.replaceAll(`:${golden.roots[0]}/`, `:${root}`);
  if (!moved.includes(`:${root}main.tex`)) throw new Error(`${golden.fixture} names no file in ${golden.roots[0]}`);
  return new Uint8Array(gzipSync(moved));
}

function expectGoldenAnswers(engine: SyncTexModule, golden: Golden, bytes: Uint8Array) {
  const index = engine.open(bytes, golden.projectPaths);
  try {
    expect(golden.forward.map(({ file, line }) => index.forward(file, line))).toEqual(
      golden.forward.map(({ hit }) => hit),
    );
    expect(golden.inverse.map(({ page, x, y }) => index.inverse(page, x, y))).toEqual(
      golden.inverse.map(({ hit }) => hit),
    );
  } finally {
    index.dispose();
  }
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof SyncTexError ? error.code : `not a SyncTexError: ${String(error)}`;
  }
  return undefined;
}

let engine: SyncTexModule;

beforeAll(async () => {
  engine = await loadSyncTex(wasm);
});

describe("SyncTeX in the browser", () => {
  it("has a golden file for every fixture", () => {
    expect(goldens.map((golden) => golden.fixture)).toEqual([
      "academic-article.synctex.gz",
      "include-book.synctex.gz",
      "lualatex-chapters.synctex.gz",
      "wrapped-prose.synctex.gz",
    ]);
  });

  it.each(goldens.map((golden) => [golden.fixture, golden] as const))(
    "answers every query on %s exactly as the desktop does",
    (_, golden) => {
      expectGoldenAnswers(engine, golden, gz(golden));
    },
  );

  it.each([
    ["a Windows machine", "C:\\Users\\Ana Lucía\\Thesis\\"],
    ["another Unix home", "/home/someone/papers/thesis/"],
  ])("finds the project folder of an output compiled on %s", (_, root) => {
    for (const golden of goldens) expectGoldenAnswers(engine, golden, movedTo(golden, root));
  });

  it("still searches without project paths, naming files by their full path", () => {
    const book = goldens.find((golden) => golden.fixture === "include-book.synctex.gz");
    if (!book) throw new Error("the include-book golden file is missing");
    const index = engine.open(gz(book), []);
    const click = book.inverse.find(({ hit }) => hit?.file === "chapters/intro.tex");
    if (!click) throw new Error("no click lands in chapters/intro.tex");
    expect(index.inverse(click.page, click.x, click.y)?.file).toBe("/p/chapters/intro.tex");
    expect(index.forward("chapters/intro.tex", 5)).toEqual(book.forward[0].hit);
    index.dispose();
  });

  it("refuses bytes that are not gzipped SyncTeX text", () => {
    expect(codeOf(() => engine.open(new TextEncoder().encode("SyncTeX Version:1\n"), []))).toBe("unreadable");
    expect(codeOf(() => engine.open(new Uint8Array(gzipSync(Buffer.from([0xff, 0xfe]))), []))).toBe("unreadable");
    expect(codeOf(() => engine.open(new Uint8Array(0), []))).toBe("unreadable");
  });

  it("refuses a point that is not on the page", () => {
    const index = engine.open(gz(goldens[0]), goldens[0].projectPaths);
    expect(codeOf(() => index.inverse(1, Number.NaN, 100))).toBe("bad-input");
    expect(codeOf(() => index.inverse(1, 100, Number.POSITIVE_INFINITY))).toBe("bad-input");
    expect(index.forward("main.tex", 20)).not.toBeNull();
    index.dispose();
  });

  it("closes an index once and refuses it after", () => {
    const index = engine.open(gz(goldens[0]), goldens[0].projectPaths);
    index.dispose();
    index.dispose();
    expect(codeOf(() => index.forward("main.tex", 20))).toBe("closed");
    expect(codeOf(() => index.inverse(1, 100, 100))).toBe("closed");
  });

  it("keeps indexes apart", () => {
    const [article, book] = [goldens[0], goldens[1]];
    const first = engine.open(gz(article), article.projectPaths);
    const second = engine.open(gz(book), book.projectPaths);
    first.dispose();
    expect(second.forward(book.forward[0].file, book.forward[0].line)).toEqual(book.forward[0].hit);
    second.dispose();
  });
});

describe("loading SyncTeX", () => {
  it("points at the module's asset", () => {
    expect(SYNCTEX_WASM_URL).toMatch(/oleafly_synctex[^/]*\.wasm$/);
  });

  it("loads from a response, a pending fetch, a compiled module, or bytes", async () => {
    const response = () => new Response(wasm, { headers: { "content-type": "application/wasm" } });
    const sources = [
      response(),
      Promise.resolve(response()),
      new Response(wasm, { headers: { "content-type": "application/octet-stream" } }),
      new WebAssembly.Module(wasm),
      new Uint8Array(wasm).buffer,
    ];
    const [{ file, line, hit }] = goldens[0].forward;
    for (const source of sources) {
      const loaded = await loadSyncTex(source);
      const index = loaded.open(gz(goldens[0]), goldens[0].projectPaths);
      expect(index.forward(file, line)).toEqual(hit);
      index.dispose();
    }
  });

  it("reports a failed download or bytes that are not WebAssembly as load-failed", async () => {
    for (const source of [new Response("missing", { status: 404 }), new Uint8Array([1, 2, 3])]) {
      await expect(loadSyncTex(source)).rejects.toMatchObject({ name: "SyncTexError", code: "load-failed" });
    }
  });

  it("stops for good after the module traps", () => {
    const exports = new WebAssembly.Instance(new WebAssembly.Module(wasm), {}).exports as unknown as SyncTexExports;
    const trapping: SyncTexExports = {
      ...exports,
      synctex_inverse: () => {
        throw new WebAssembly.RuntimeError("unreachable");
      },
    };
    const crashing = createSyncTexModule(trapping);
    const index = crashing.open(gz(goldens[0]), goldens[0].projectPaths);
    expect(codeOf(() => index.inverse(1, 100, 100))).toBe("crashed");
    expect(codeOf(() => index.forward("main.tex", 20))).toBe("crashed");
    expect(codeOf(() => crashing.open(gz(goldens[0]), []))).toBe("crashed");
  });
});
