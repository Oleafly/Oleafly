import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/typst-forms", () => ({ loadTypstFormCatalog: vi.fn(async () => ({ version: "", watch: [], forms: [], diagnostics: [] })) }));

import { EMPTY_TYPST_FORM_CATALOG } from "@oleafly/editor/typst-forms";
import { useTypstFormsStore } from "@/store/typst-forms";
import { typstFormsPort } from "./visual-typst-forms";

describe("the Typst forms port", () => {
  it("hands the editor the store's catalog and tells it when the catalog changes", () => {
    const listener = vi.fn();
    const unsubscribe = typstFormsPort.subscribe(listener);
    const next = { ...EMPTY_TYPST_FORM_CATALOG, version: "v1" };
    useTypstFormsStore.setState({ wanted: ["@local/a:1.0.0"] });
    expect(listener).not.toHaveBeenCalled();
    useTypstFormsStore.setState({ catalog: next });
    expect(listener).toHaveBeenCalledOnce();
    expect(typstFormsPort.snapshot()).toBe(next);
    unsubscribe();
    useTypstFormsStore.setState({ catalog: EMPTY_TYPST_FORM_CATALOG });
    expect(listener).toHaveBeenCalledOnce();
  });

  it("passes wanted packages to the store", () => {
    const want = vi.fn();
    useTypstFormsStore.setState({ want });
    typstFormsPort.want(["@local/a:1.0.0"]);
    expect(want).toHaveBeenCalledWith(["@local/a:1.0.0"]);
  });
});
