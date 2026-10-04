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
import { APP_ERROR_PREFIX } from "@/lib/app-error";
import { LATEX_ENGINE } from "@/lib/document-engine";
import type { DocumentEngineDescriptor, TypstToolchainStatus } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useTypstToolchainStore } from "@/store/typst-toolchain";
import type { TypstUpgradeReport } from "./api";
import { openTypstUpgrade } from "./open";
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

describe("Typst upgrade report details", () => {
  it("shows build failures, unknown page counts and when nothing changed", async () => {
    mocks.check.mockResolvedValueOnce({
      current: { version: "0.13.1", ok: true, pages: null, errors: 0, warnings: 0, compileTimeMs: 1, failure: null },
      candidate: {
        version: "0.15.1",
        ok: false,
        pages: 3,
        errors: 2,
        warnings: 0,
        compileTimeMs: 1,
        failure: "error: package not found",
      },
      added: [],
      removed: [],
      unchanged: 0,
    } satisfies TypstUpgradeReport);
    render(<TypstUpgradeDialog open onClose={vi.fn()} />);

    expect(await screen.findByText(copy.noChanges)).toBeInTheDocument();
    expect(screen.getByText(copy.pagesUnknown)).toBeInTheDocument();
    expect(screen.getByText("Typst 0.15.1 could not build the project.")).toBeInTheDocument();
    expect(screen.getByText("error: package not found")).toBeInTheDocument();
    expect(screen.queryByText(/The page count/)).toBeNull();
    expect(screen.queryByText(/same in both versions/)).toBeNull();
  });

  it("says when the page count stays the same and lists findings without a location", async () => {
    mocks.check.mockResolvedValueOnce({
      ...report("0.15.1"),
      current: { ...report("0.15.1").current, pages: 4 },
      candidate: { ...report("0.15.1").candidate, pages: 4 },
      added: [
        { kind: "warning", file: "refs.typ", line: null, column: null, message: "unused label", hints: [] },
        { kind: "error", file: null, line: null, column: null, message: "font missing", hints: [] },
      ],
    });
    render(<TypstUpgradeDialog open onClose={vi.fn()} />);

    expect(await screen.findByText("The page count stays at 4.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /unused label/ })).toHaveTextContent("refs.typ");
    expect(screen.getByRole("button", { name: /font missing/ })).toBeDisabled();
  });

  it("reports a failed switch and keeps the dialog open", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    mocks.setTypstVersion.mockRejectedValueOnce(new Error("pin rejected"));
    render(<TypstUpgradeDialog open onClose={onClose} />);
    await screen.findByText("unknown function: oldfn");

    await user.click(screen.getByRole("button", { name: "Switch to Typst 0.15.1" }));

    await waitFor(() =>
      expect(mocks.errorUnique).toHaveBeenCalledWith("engine-switch:project", copy.switchFailed),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Switch to Typst 0.15.1" })).toBeEnabled();
  });

  it("describes a structured switch failure", async () => {
    const user = userEvent.setup();
    mocks.setTypstVersion.mockRejectedValueOnce(
      `${APP_ERROR_PREFIX}${JSON.stringify({ code: "project.not_found", params: {} })}`,
    );
    render(<TypstUpgradeDialog open onClose={vi.fn()} />);
    await screen.findByText("unknown function: oldfn");

    await user.click(screen.getByRole("button", { name: "Switch to Typst 0.15.1" }));

    await waitFor(() =>
      expect(mocks.errorUnique).toHaveBeenCalledWith(
        "engine-switch:project",
        "This project is no longer in your library.",
      ),
    );
  });

  it("runs the check again from the footer", async () => {
    const user = userEvent.setup();
    render(<TypstUpgradeDialog open onClose={vi.fn()} />);
    await screen.findByText("unknown function: oldfn");

    await user.click(screen.getByRole("button", { name: copy.runAgain }));

    await waitFor(() => expect(mocks.check).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("unknown function: oldfn")).toBeInTheDocument();
  });

  it("ignores a result for a version the user moved away from", async () => {
    let finishFirst: (value: TypstUpgradeReport) => void = () => {};
    mocks.check.mockImplementationOnce(
      () =>
        new Promise<TypstUpgradeReport>((resolve) => {
          finishFirst = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<TypstUpgradeDialog open onClose={vi.fn()} initialVersion="0.14.2" />);
    await waitFor(() => expect(mocks.check).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole("button", { name: "0.15.1" }));
    await screen.findByText("New in Typst 0.15.1");
    finishFirst(report("0.14.2"));

    await waitFor(() => expect(screen.queryByText("New in Typst 0.14.2")).toBeNull());
    expect(screen.getByRole("button", { name: "0.15.1" })).toHaveAttribute("aria-pressed", "true");
  });

  it("waits for the toolchain before offering versions", () => {
    useTypstToolchainStore.setState({ status: null });
    render(<TypstUpgradeDialog open onClose={vi.fn()} />);

    expect(screen.getByText(copy.compareWith)).toBeInTheDocument();
    expect(mocks.check).not.toHaveBeenCalled();
  });

  it("opens the Typst settings when no newer version is installed", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    useSettingsStore.setState({ settingsOpen: false });
    useFilesStore.setState({
      engine: { ...engine, typst_version: null, typst_resolved: { version: "0.15.1", source: "bundled" } },
    });
    render(<TypstUpgradeDialog open onClose={onClose} />);

    await user.click(await screen.findByRole("button", { name: copy.openSettings }));

    expect(onClose).toHaveBeenCalled();
    expect(useSettingsStore.getState().settingsOpen).toBe(true);
    expect(useSettingsStore.getState().settingsInitialSection).toBe("engine");
  });
});

describe("opening the upgrade check from anywhere", () => {
  it("mounts one shared dialog and reopens it for a later request", async () => {
    const user = userEvent.setup();
    openTypstUpgrade("0.14.2");

    expect(await screen.findByText("New in Typst 0.14.2")).toBeInTheDocument();
    await user.click(within(screen.getByTestId("typst-upgrade-dialog")).getAllByRole("button", { name: copy.close }).at(-1) as HTMLElement);
    await waitFor(() => expect(screen.queryByTestId("typst-upgrade-dialog")).toBeNull());

    openTypstUpgrade();
    expect(await screen.findByText("New in Typst 0.15.1")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-typst-upgrade]")).toHaveLength(1);
  });
});
