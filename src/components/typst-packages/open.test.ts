import { describe, expect, it, vi } from "vitest";

const dialog = vi.hoisted(() => ({ showTypstPackagesDialog: vi.fn() }));
const log = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("./TypstPackagesDialog", () => dialog);
vi.mock("@/lib/log", () => log);

import { openTypstPackages } from "./open";

describe("openTypstPackages", () => {
  it("loads the dialog on demand and shows it", async () => {
    openTypstPackages();
    await vi.waitFor(() => expect(dialog.showTypstPackagesDialog).toHaveBeenCalledOnce());
  });

  it("logs a dialog that fails to open", async () => {
    dialog.showTypstPackagesDialog.mockImplementationOnce(() => {
      throw new Error("no document");
    });
    openTypstPackages();
    await vi.waitFor(() =>
      expect(log.logError).toHaveBeenCalledWith("open Typst packages", expect.any(Error)),
    );
  });
});
