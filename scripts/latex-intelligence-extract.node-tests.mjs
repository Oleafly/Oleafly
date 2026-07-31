import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSnippet, parseArgs } from "./latex-intelligence-extract.mjs";

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
