import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeAtSuggestions,
  normalizeSnippet,
  parseArgs,
} from "./latex-intelligence-extract.mjs";

test("normalizeSnippet keeps already-normalized CodeMirror fields untouched", () => {
  assert.equal(
    normalizeSnippet("ang[${2:options}]{${1:angle}}"),
    "ang[${2:options}]{${1:angle}}",
  );
});

test("normalizeSnippet rewrites bare VS Code tabstops to CodeMirror fields", () => {
  // $N -> ${N}; the final-cursor tabstop $0 becomes an empty field.
  assert.equal(
    normalizeSnippet("begin{$1}\n\t$0\n\\\\end{$1}"),
    "begin{${1}}\n\t${}\n\\end{${1}}",
  );
  // Multi-digit tabstops keep all their digits.
  assert.equal(normalizeSnippet("a$10b"), "a${10}b");
});

test("normalizeSnippet replaces VS Code variables with an empty field", () => {
  assert.equal(normalizeSnippet("${TM_SELECTED_TEXT}"), "${}");
  assert.equal(normalizeSnippet("x${TM_FILENAME_BASE}y"), "x${}y");
});

test("normalizeSnippet decodes the VS Code snippet escapes \\\\, \\}, and \\$", () => {
  // Inputs are JSON-decoded upstream strings, so "\\}" here is one
  // backslash followed by a brace.
  assert.equal(normalizeSnippet("foo\\}bar"), "foo}bar");
  assert.equal(normalizeSnippet("foo\\$bar"), "foo$bar");
  assert.equal(normalizeSnippet("foo\\\\bar"), "foo\\bar");
  // LaTeX \{ ... \} arrives VS Code-escaped as \\\{ ... \\\} and must
  // come out as the literal LaTeX commands.
  assert.equal(normalizeSnippet("Bigl\\\\\\{${1}\\\\\\}"), "Bigl\\\\{${1}\\}");
});

test("normalizeSnippet is a no-op on normalized snippets without escapes", () => {
  const normalized = [
    "ang[${2:options}]{${1:angle}}",
    "begin{${1}}\n\t${}\n\\end{${1}}",
    "${}",
    "a${10}b",
  ];
  for (const snippet of normalized) {
    assert.equal(normalizeSnippet(snippet), snippet);
  }
});

test("normalizeSnippet re-decodes backslash escapes on a second pass", () => {
  // Documents current behavior: the escape-decoding step is NOT idempotent
  // for outputs that legitimately contain backslash-brace (LaTeX \{ \}) or
  // double backslashes. The extractor only ever runs it once per snippet,
  // so committed data is unaffected, but re-normalizing corrupts them.
  const once = normalizeSnippet("Bigl\\\\\\{${1}\\\\\\}");
  assert.equal(once, "Bigl\\\\{${1}\\}");
  assert.equal(normalizeSnippet(once), "Bigl\\{${1}}");
});

test("normalizeAtSuggestions maps entries to sorted trigger/replacement/detail", () => {
  assert.deepEqual(
    normalizeAtSuggestions({
      infinity: { prefix: "@8", body: "\\infty", description: "infinity symbol" },
      alpha: { prefix: "@a", body: "\\alpha", description: "alpha" },
    }),
    [
      { trigger: "@8", replacement: "\\infty", detail: "infinity symbol" },
      { trigger: "@a", replacement: "\\alpha", detail: "alpha" },
    ],
  );
});

test("normalizeAtSuggestions snippet-normalizes bodies via normalizeSnippet", () => {
  assert.deepEqual(
    normalizeAtSuggestions({
      fraction: { prefix: "@/", body: "\\frac{$1}{$2}$0", description: "fraction" },
      hat: { prefix: "@^", body: "\\hat{${1:${TM_SELECTED_TEXT}}}$0", description: "hat" },
    }),
    [
      { trigger: "@/", replacement: "\\frac{${1}}{${2}}${}", detail: "fraction" },
      { trigger: "@^", replacement: "\\hat{${1:${}}}${}", detail: "hat" },
    ],
  );
});

test("normalizeAtSuggestions keeps duplicate triggers in deterministic order", () => {
  // Upstream really has two `@|` entries (Big| and left|...right|).
  const result = normalizeAtSuggestions({
    "Big|": { prefix: "@|", body: "\\Big|", description: "Big |" },
    "|": { prefix: "@|", body: "\\left| $1 \\right|", description: "left| ... right|" },
  });
  assert.deepEqual(
    result,
    [
      { trigger: "@|", replacement: "\\Big|", detail: "Big |" },
      { trigger: "@|", replacement: "\\left| ${1} \\right|", detail: "left| ... right|" },
    ],
  );
});

test("normalizeAtSuggestions omits detail only when description is absent", () => {
  assert.deepEqual(normalizeAtSuggestions({ x: { prefix: "@x", body: "\\chi" } }), [
    { trigger: "@x", replacement: "\\chi" },
  ]);
});

test("normalizeAtSuggestions hard-fails on unknown upstream fields", () => {
  assert.throws(
    () =>
      normalizeAtSuggestions({
        x: { prefix: "@x", body: "\\chi", description: "chi", scope: "math" },
      }),
    /at-suggestions\.json\[x\]: unhandled key "scope"/,
  );
});

test("normalizeAtSuggestions hard-fails on prefixes without a leading @", () => {
  assert.throws(
    () => normalizeAtSuggestions({ x: { prefix: "x", body: "\\chi", description: "chi" } }),
    /at-suggestions\.json\[x\]\.prefix: expected a leading "@"/,
  );
});

test("normalizeAtSuggestions hard-fails on non-string prefix or body", () => {
  assert.throws(
    () => normalizeAtSuggestions({ x: { prefix: 1, body: "\\chi" } }),
    /at-suggestions\.json\[x\]\.prefix: expected a string/,
  );
  assert.throws(
    () => normalizeAtSuggestions({ x: { prefix: "@x", body: null } }),
    /at-suggestions\.json\[x\]\.body: expected a string/,
  );
});

test("parseArgs accepts --tarball and --out with values", () => {
  assert.deepEqual(parseArgs(["--tarball", "x", "--out", "y"]), {
    tarball: "x",
    out: "y",
    help: false,
  });
});

test("parseArgs defaults to no tarball, no out, and no help", () => {
  assert.deepEqual(parseArgs([]), { tarball: null, out: null, help: false });
});

test("parseArgs recognizes both help spellings", () => {
  assert.deepEqual(parseArgs(["--help"]), { tarball: null, out: null, help: true });
  assert.deepEqual(parseArgs(["-h"]), { tarball: null, out: null, help: true });
});

test("parseArgs skips a bare -- separator", () => {
  assert.deepEqual(parseArgs(["--", "--help"]), {
    tarball: null,
    out: null,
    help: true,
  });
});

test("parseArgs rejects unknown flags", () => {
  assert.throws(() => parseArgs(["--bogus"]), /unknown argument: --bogus/);
});

test("parseArgs rejects value flags with a missing or flag-like value", () => {
  assert.throws(() => parseArgs(["--tarball"]), /--tarball requires a value/);
  assert.throws(() => parseArgs(["--out"]), /--out requires a value/);
  assert.throws(() => parseArgs(["--tarball", "--out"]), /--tarball requires a value/);
});
