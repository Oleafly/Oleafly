import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { EMPTY_TYPST_FORM_CATALOG } from "@oleafly/editor/typst-forms";
import { loadTypstFormCatalog } from "./typst-forms";

beforeEach(() => {
  invoke.mockReset();
});

describe("loadTypstFormCatalog", () => {
  it("asks the backend for the project's catalog and the imported packages", async () => {
    invoke.mockResolvedValue(EMPTY_TYPST_FORM_CATALOG);
    await expect(loadTypstFormCatalog("p1", ["@local/acme-report:0.1.0"])).resolves.toBe(EMPTY_TYPST_FORM_CATALOG);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("typst_form_catalog", {
      projectId: "p1",
      packages: ["@local/acme-report:0.1.0"],
    });
  });

  it("passes a backend failure on", async () => {
    invoke.mockRejectedValue(new Error("no such project"));
    await expect(loadTypstFormCatalog("p1", [])).rejects.toThrow("no such project");
  });
});
