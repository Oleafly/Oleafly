// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  setTypstVersion: vi.fn(async (_version: string | null) => {}),
  openLocation: vi.fn(async () => true),
  success: vi.fn(),
  errorUnique: vi.fn(),
  openSettings: vi.fn(),
}));

vi.mock("./api", () => ({ typstUpgradeCheck: mocks.check }));
vi.mock("@/lib/open-location", () => ({ openProjectLocation: mocks.openLocation }));
vi.mock("@/lib/toast", () => ({ toast: { success: mocks.success, errorUnique: mocks.errorUnique } }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { LATEX_ENGINE } from "@/lib/document-engine";
import type { DocumentEngineDescriptor, TypstToolchainStatus } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useTypstToolchainStore } from "@/store/typst-toolchain";
import type { TypstUpgradeReport } from "./api";
import { TypstUpgradeDialog } from "./TypstUpgradeDialog";

const copy = enShell.typstUpgrade;

const engine: DocumentEngineDescriptor = {
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

const toolchain: TypstToolchainStatus = {
  bundledVersion: "0.15.1",
  defaultVersion: "0.15.1",
  defaultChoice: null,
  system: null,
  installing: null,
  versions: [
    { version: "0.15.1", releasedAt: null, inCatalog: true, sources: ["bundled"], downloadBytes: null },
    { version: "0.14.2", releasedAt: null, inCatalog: true, sources: ["downloaded"], downloadBytes: null },
    { version: "0.13.1", releasedAt: null, inCatalog: true, sources: ["downloaded"], downloadBytes: null },
  ],
};

function report(candidate: string): TypstUpgradeReport {
  return {
    current: { version: "0.13.1", ok: true, pages: 10, errors: 0, warnings: 1, compileTimeMs: 40, failure: null },
    candidate: { version: candidate, ok: false, pages: 11, errors: 1, warnings: 0, compileTimeMs: 30, failure: null },
    added: [
      { kind: "error", file: "chapters/intro.typ", line: 7, column: 3, message: "unknown function: oldfn", hints: [] },
    ],
    removed: [
      { kind: "warning", file: "main.typ", line: 2, column: null, message: "deprecated: use x", hints: [] },
    ],
    unchanged: 3,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.check.mockImplementation(async ({ version }: { version: string }) => report(version));
  useFilesStore.setState({
    projectId: "project",
    mainDoc: "main.typ",
    engine,
    engineLoaded: true,
    setTypstVersion: mocks.setTypstVersion,
  });
  useTypstToolchainStore.setState({
    status: toolchain,
    loading: false,
    loadFailed: false,
    ensureLoaded: vi.fn(async () => toolchain),
  });
});

describe("Typst upgrade dialog", () => {
  it("compares the project's version with the newest installed one", async () => {
    render(<TypstUpgradeDialog open onClose={vi.fn()} />);
    await screen.findByText("unknown function: oldfn");
    expect(mocks.check).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project", mainDoc: "main.typ", version: "0.15.1" }),
    );
    expect(screen.getByText("Typst 0.13.1 (current)")).toBeInTheDocument();
    expect(screen.getByText("The page count changes from 10 to 11.")).toBeInTheDocument();
    expect(screen.getByText("New in Typst 0.15.1")).toBeInTheDocument();
    expect(screen.getByText("No longer reported by Typst 0.15.1")).toBeInTheDocument();
    expect(screen.getByText("deprecated: use x")).toBeInTheDocument();
    expect(screen.getByText("3 messages are the same in both versions.")).toBeInTheDocument();
  });

  it("checks the version the entry point asked for and lets the user pick another", async () => {
    const user = userEvent.setup();
    render(<TypstUpgradeDialog open onClose={vi.fn()} initialVersion="0.14.2" />);
    await screen.findByText("New in Typst 0.14.2");
    await user.click(screen.getByRole("button", { name: "0.15.1" }));
    await screen.findByText("New in Typst 0.15.1");
    expect(mocks.check.mock.calls.map(([request]) => request.version)).toEqual(["0.14.2", "0.15.1"]);
  });

  it("jumps to a finding in the editor", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<TypstUpgradeDialog open onClose={onClose} />);
    await user.click(await screen.findByRole("button", { name: /unknown function: oldfn/ }));
    expect(onClose).toHaveBeenCalled();
    expect(mocks.openLocation).toHaveBeenCalledWith(
      { path: "chapters/intro.typ", line: 7, column: 3 },
      { pdfView: "editor" },
    );
  });

  it("closes Settings when a check started there jumps to a finding", async () => {
    useSettingsStore.setState({ settingsOpen: true });
    const user = userEvent.setup();
    render(<TypstUpgradeDialog open onClose={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: /unknown function: oldfn/ }));
    expect(useSettingsStore.getState().settingsOpen).toBe(false);
    expect(mocks.openLocation).toHaveBeenCalledOnce();
  });

  it("switches the pin only when asked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<TypstUpgradeDialog open onClose={onClose} />);
    await screen.findByText("unknown function: oldfn");
    expect(mocks.setTypstVersion).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Switch to Typst 0.15.1" }));
    await waitFor(() => expect(mocks.setTypstVersion).toHaveBeenCalledWith("0.15.1"));
    expect(mocks.success).toHaveBeenCalledWith("This project now uses Typst 0.15.1.");
    expect(onClose).toHaveBeenCalled();
  });

  it("shows why a check failed and can run it again", async () => {
    const user = userEvent.setup();
    mocks.check.mockRejectedValueOnce(new Error("Typst crashed"));
    render(<TypstUpgradeDialog open onClose={vi.fn()} />);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(copy.checkFailed, { exact: false })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: copy.runAgain }));
    await screen.findByText("unknown function: oldfn");
  });

  it("says so when no newer version is installed", async () => {
    useFilesStore.setState({ engine: { ...engine, typst_version: null, typst_resolved: { version: "0.15.1", source: "bundled" } } });
    render(<TypstUpgradeDialog open onClose={vi.fn()} />);
    expect(await screen.findByText(copy.noNewer)).toBeInTheDocument();
    expect(mocks.check).not.toHaveBeenCalled();
  });
});
