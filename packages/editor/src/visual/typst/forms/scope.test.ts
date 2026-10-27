import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { beforeAll, describe, expect, it } from "vitest";
import { loadTypstParser } from "../../../typst";
import { EMPTY_TYPST_FORM_CATALOG, staticTypstForms } from "../../../typst-forms";
import { readTypstFormsFixture, typstFormsGolden } from "../../../typst-forms-test-support";
import { calleeName, hashBefore } from "../syntax";
import { typstState } from "../test-support";
import { buildFormIndex, documentBindings, FormScope, resolveImportPath } from "./scope";
import { formScopeFor } from "./state";

beforeAll(async () => {
  await loadTypstParser();
});

const ACME = "@local/acme-report:0.1.0";

function scopeOf(state: EditorState): FormScope {
  return FormScope.create(buildFormIndex(typstFormsGolden()), documentBindings(state, syntaxTree(state)));
}

// One row per `#`-call in document order: the callee and the form id it resolves to.
function resolved(doc: string, path = "report.typ"): string[][] {
  const state = typstState(doc, { path });
  const scope = scopeOf(state);
  const rows: string[][] = [];
  syntaxTree(state).iterate({
    enter(ref) {
      if (ref.name !== "FuncCall" || !hashBefore(ref.node)) return;
      const callee = calleeName(state, ref.node) ?? "?";
      rows.push([callee, scope.resolve(callee, ref.from)?.id ?? "none"]);
    },
  });
  return rows;
}

const pkg = (fn: string) => `pkg:${ACME}#${fn}`;
const memo = "mod:template/memo.typ#memo-header";

describe("matching calls to forms", () => {
  it("resolves every call in the fixture report", () => {
    expect(resolved(readTypstFormsFixture("project/report.typ"))).toEqual([
      ["acme.cover-page", pkg("cover-page")],
      ["info-box", pkg("info-box")],
      ["badge", pkg("status-badge")],
      ["info-box", pkg("info-box")],
      ["memo-header", memo],
      ["acme.sign-off", pkg("sign-off")],
    ]);
  });

  it("resolves the edge cases: wildcard, shadowing, built-in names", () => {
    const rows = [
      ["info-box", pkg("info-box")],
      ["info-box", pkg("info-box")],
      ["info-box", pkg("info-box")],
      ["info-box", pkg("info-box")],
      ["status-badge", pkg("status-badge")],
      ["info-box", pkg("info-box")],
      ["sign-off", pkg("sign-off")],
      ["sign-off", "none"],
      ["table", "none"],
      ["acme.table", pkg("table")],
    ];
    expect(resolved(readTypstFormsFixture("project/edge-cases.typ"))).toEqual(rows);
    expect(resolved(readTypstFormsFixture("project/edge-cases-crlf.typ"))).toEqual(rows);
  });

  it.each([
    ["an alias and its items", `#import "${ACME}" as a: info-box\n#a.sign-off(name: "x")\n#info-box(title: "t")[b]`, [
      ["a.sign-off", pkg("sign-off")],
      ["info-box", pkg("info-box")],
    ]],
    ["a module import by its package name", `#import "${ACME}"\n#acme-report.sign-off(name: "x")`, [
      ["acme-report.sign-off", pkg("sign-off")],
    ]],
    ["a selective import, which binds no module", `#import "${ACME}": info-box\n#acme-report.sign-off(name: "x")`, [
      ["acme-report.sign-off", "none"],
    ]],
    ["a renamed built-in name", `#import "${ACME}": table as acme-table\n#acme-table(caption: "c")\n#table(columns: 1, [a])`, [
      ["acme-table", pkg("table")],
      ["table", "none"],
    ]],
    ["a call before its import", `#info-box(title: "early")[x]\n#import "${ACME}": info-box\n#info-box(title: "late")[y]`, [
      ["info-box", "none"],
      ["info-box", pkg("info-box")],
    ]],
    ["a later import that shadows an earlier one", `#import "${ACME}": info-box\n#import "template/memo.typ": memo-header as info-box\n#info-box(to: "x")`, [
      ["info-box", memo],
    ]],
    ["an import nested in a block", `#[#import "${ACME}": info-box]\n#info-box(title: "x")[y]`, [
      ["info-box", "none"],
    ]],
    ["another version of the package", `#import "@local/acme-report:0.1.1": info-box\n#info-box(title: "x")[y]`, [["info-box", "none"]]],
    ["a wildcard over a file with no forms", `#import "lib.typ": *\n#info-box(title: "x")[y]`, [["info-box", "none"]]],
    ["a path module by its file stem", `#import "template/memo.typ"\n#memo.memo-header(to: "x")`, [["memo.memo-header", memo]]],
    ["a dotted item, which never matches but still shadows", `#import "${ACME}": info-box\n#import "x.typ": a.info-box\n#info-box(title: "x")[y]`, [
      ["info-box", "none"],
    ]],
    ["a destructuring let", `#import "${ACME}": info-box, sign-off\n#let (info-box, other: sign-off) = (1, other: 2)\n#info-box(title: "x")[y]\n#sign-off(name: "s")`, [
      ["info-box", "none"],
      ["sign-off", "none"],
    ]],
  ])("handles %s", (_name, doc, rows) => {
    expect(resolved(doc)).toEqual(rows);
  });

  it.each([
    ["chapters/one.typ", "../template/memo.typ", [["memo-header", memo]]],
    ["chapters/one.typ", "/template/memo.typ", [["memo-header", memo]]],
    ["report.typ", "./template/memo.typ", [["memo-header", memo]]],
    ["report.typ", "../template/memo.typ", [["memo-header", "none"]]],
    ["report.typ", String.raw`template\\memo.typ`, [["memo-header", "none"]]],
  ])("resolves a path import from %s to %s", (path, importPath, rows) => {
    expect(resolved(`#import "${importPath}": memo-header\n#memo-header(to: "x")`, path)).toEqual(rows);
  });

  it("gives no scope for an empty catalog", () => {
    const empty = typstState(readTypstFormsFixture("project/report.typ"), {
      path: "report.typ",
      ports: { resolveImage: async () => null, typstForms: staticTypstForms(EMPTY_TYPST_FORM_CATALOG) },
    });
    expect(formScopeFor(empty, syntaxTree(empty))).toBeNull();
    const full = typstState(readTypstFormsFixture("project/report.typ"), {
      path: "report.typ",
      ports: { resolveImage: async () => null, typstForms: staticTypstForms(typstFormsGolden()) },
    });
    expect(formScopeFor(full, syntaxTree(full))).toBeInstanceOf(FormScope);
  });
});

describe("document bindings", () => {
  it("reads each package once and caches the result per tree", () => {
    const state = typstState(readTypstFormsFixture("project/report.typ"), { path: "report.typ" });
    const bindings = documentBindings(state, syntaxTree(state));
    expect(bindings.packages).toEqual([ACME]);
    expect(bindings.imports.map((entry) => [entry.source, entry.module])).toEqual([
      [{ kind: "package", spec: ACME }, "acme"],
      [{ kind: "package", spec: ACME }, null],
      [{ kind: "module", path: "template/memo.typ" }, null],
    ]);
    expect(documentBindings(state, syntaxTree(state))).toBe(bindings);
  });

  it("caches scopes per catalog and bindings", () => {
    const state = typstState(readTypstFormsFixture("project/report.typ"), { path: "report.typ" });
    const index = buildFormIndex(typstFormsGolden());
    const bindings = documentBindings(state, syntaxTree(state));
    expect(FormScope.create(index, bindings)).toBe(FormScope.create(index, bindings));
  });
});

describe("resolveImportPath", () => {
  it.each([
    [null, "a.typ", "a.typ"],
    ["sub/doc.typ", "a.typ", "sub/a.typ"],
    ["sub/doc.typ", "../a.typ", "a.typ"],
    ["sub/doc.typ", "/a.typ", "a.typ"],
    [String.raw`sub\doc.typ`, "a.typ", "sub/a.typ"],
    ["sub/doc.typ", "./x//a.typ", "sub/x/a.typ"],
    ["doc.typ", "../a.typ", null],
    ["doc.typ", String.raw`x\a.typ`, null],
    ["doc.typ", "/", null],
  ])("from %s, %s is %s", (document, importPath, expected) => {
    expect(resolveImportPath(document, importPath)).toBe(expected);
  });
});
