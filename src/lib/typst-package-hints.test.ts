import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { resetUniverseIndexCache, type UniversePackage } from "./typst-universe";
import { typstPackageHints } from "./typst-package-hints";

const hints = en.typstPackages.hints;

function universePackage(name: string, version: string): UniversePackage {
  return {
    name,
    version,
    versions: [version],
    description: "",
    authors: [],
    license: null,
    keywords: [],
    categories: [],
    disciplines: [],
    compiler: null,
    template: false,
    updatedAt: null,
    homepage: null,
  };
}

const TEXT = '#import "@preview/cetz:0.4.2": canvas\n#import "@preview/tablex:0.0.9"\n';

describe("typstPackageHints", () => {
  beforeEach(() => {
    invoke.mockReset();
    resetUniverseIndexCache();
  });

  it("offers an update for imports older than the newest release", async () => {
    invoke.mockResolvedValue({
      fetchedAt: 1,
      stale: false,
      packages: [universePackage("cetz", "0.5.2"), universePackage("tablex", "0.0.9")],
    });
    const diagnostics = await typstPackageHints(TEXT, false);
    expect(invoke).toHaveBeenCalledWith("typst_universe_index", { offline: false, refresh: false });
    expect(diagnostics).toHaveLength(1);
    const [hint] = diagnostics;
    expect(hint.severity).toBe("info");
    expect(TEXT.slice(hint.from, hint.to)).toBe("0.4.2");
    expect(hint.message).toBe(
      hints.updateAvailable
        .replace("{{name}}", "cetz")
        .replace("{{latest}}", "0.5.2")
        .replace("{{version}}", "0.4.2"),
    );
    expect(hint.actions?.map((action) => action.name)).toEqual([
      hints.update.replace("{{version}}", "0.5.2"),
    ]);

    let state = EditorState.create({ doc: TEXT });
    const view = {
      dispatch: (spec: Parameters<EditorState["update"]>[0]) => {
        state = state.update(spec).state;
      },
    };
    hint.actions?.[0].apply(view as never, hint.from, hint.to);
    expect(state.doc.toString()).toContain('"@preview/cetz:0.5.2"');
  });

  it("stays quiet without imports, offline without a list, or when the list fails", async () => {
    expect(await typstPackageHints("= Title", false)).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
    invoke.mockRejectedValue(new Error("offline"));
    expect(await typstPackageHints(TEXT, true)).toEqual([]);
    expect(invoke).toHaveBeenCalledWith("typst_universe_index", { offline: true, refresh: false });
  });
});
