import { describe, expect, it, vi } from "vitest";

const dialog = vi.hoisted(() => ({ showLatexPackagesDialog: vi.fn() }));
const log = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock("./LatexPackagesDialog", () => dialog);
vi.mock("@/lib/log", () => log);

import { openLatexPackages } from "./open";

describe("openLatexPackages", () => {
  it("loads the dialog on demand and shows it", async () => {
    openLatexPackages();
    await vi.waitFor(() => expect(dialog.showLatexPackagesDialog).toHaveBeenCalledOnce());
  });

  it("logs a dialog that fails to open", async () => {
    dialog.showLatexPackagesDialog.mockImplementationOnce(() => {
      throw new Error("no document");
    });
    openLatexPackages();
    await vi.waitFor(() =>
      expect(log.logError).toHaveBeenCalledWith("open LaTeX packages", expect.any(Error)),
    );
  });
});
