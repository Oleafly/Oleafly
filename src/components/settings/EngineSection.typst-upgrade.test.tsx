// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  openTypstUpgrade: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: mocks.invoke }));
vi.mock("@/components/typst-upgrade/open", () => ({ openTypstUpgrade: mocks.openTypstUpgrade }));
vi.mock("@/features/pandoc", () => ({ ensurePandoc: vi.fn(async () => true) }));

import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { LATEX_ENGINE } from "@/lib/document-engine";
import type { DocumentEngineDescriptor, TypstToolchainStatus } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useTypstToolchainStore } from "@/store/typst-toolchain";
import { EngineSection } from "@/components/settings/EngineSection";

const copy = enSettings.engine.typst.upgrade;

const status: TypstToolchainStatus = {
  bundledVersion: "0.15.1",
  defaultVersion: "0.15.1",
  defaultChoice: null,
  system: null,
  installing: null,
  versions: [
    { version: "0.15.1", releasedAt: null, inCatalog: true, sources: ["bundled"], downloadBytes: 1 },
    { version: "0.13.1", releasedAt: null, inCatalog: true, sources: ["downloaded"], downloadBytes: 1 },
  ],
};

const typst: DocumentEngineDescriptor = {
  ...LATEX_ENGINE,
  id: "typst",
  label: "Typst",
  source_format: "typst",
  main_document: "main.typ",
  source_extensions: ["typ"],
  typst_version: "0.13.1",
  typst_resolved: { version: "0.13.1", source: "downloaded" },
  typst_missing: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "typst_toolchain_status") return status;
    if (command === "tlmgr_installed" || command === "tex_distributions") return [];
    if (command === "tinytex_install_state") return { partial_download_bytes: 0 };
    return null;
  });
  useTypstToolchainStore.setState({ status, loading: false, loadFailed: false, install: null, busy: false });
});

describe("Typst upgrade check in Settings", () => {
  it("offers the check for the open Typst project", async () => {
    useFilesStore.setState({ projectId: "p1", engine: typst, engineLoaded: true });
    const user = userEvent.setup();
    render(<EngineSection />);
    await user.click(screen.getByTestId("engines-tab-typst"));
    expect(await screen.findByText(copy.heading)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Check with Typst 0.15.1" }));
    expect(mocks.openTypstUpgrade).toHaveBeenCalledWith("0.15.1");
  });

  it("is absent without an open Typst project", async () => {
    useFilesStore.setState({ projectId: null, engine: LATEX_ENGINE, engineLoaded: true });
    const user = userEvent.setup();
    render(<EngineSection />);
    await user.click(screen.getByTestId("engines-tab-typst"));
    await screen.findByText(enSettings.engine.typst.heading);
    expect(screen.queryByText(copy.heading)).not.toBeInTheDocument();
  });
});
