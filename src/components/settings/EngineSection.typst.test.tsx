// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TypstInstallProgress, TypstToolchainStatus } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  errorUnique: vi.fn(),
  successUnique: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: mocks.invoke,
  Channel: class<T> {
    onmessage: (message: T) => void = () => {};
  },
}));
vi.mock("@/lib/toast", () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    errorUnique: mocks.errorUnique,
    infoUnique: vi.fn(),
    successUnique: mocks.successUnique,
  },
}));
vi.mock("@/features/pandoc", () => ({ ensurePandoc: vi.fn(async () => true) }));

import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { resetDisplayHomes } from "@/lib/display-path";
import { formatDownloadSize } from "@/lib/download-size";
import { useEngineStore } from "@/store/engine";
import { useSettingsStore } from "@/store/settings";
import { TYPST_SETTINGS_TARGET, useTypstToolchainStore } from "@/store/typst-toolchain";
import { EngineSection } from "@/components/settings/EngineSection";

const copy = enSettings.engine.typst;
const fill = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((text, [key, value]) => text.replace(`{{${key}}}`, String(value)), template);

function status(over: Partial<TypstToolchainStatus> = {}): TypstToolchainStatus {
  return {
    bundledVersion: "0.15.1",
    defaultVersion: "0.15.1",
    defaultChoice: null,
    system: null,
    installing: null,
    versions: [
      { version: "0.15.1", releasedAt: "2026-08-01", inCatalog: true, sources: ["bundled"], downloadBytes: 10_400_000 },
      { version: "0.14.2", releasedAt: "2026-03-01", inCatalog: true, sources: [], downloadBytes: 9_800_000 },
      { version: "0.13.1", releasedAt: "2025-03-07", inCatalog: true, sources: ["downloaded"], downloadBytes: 8_200_000 },
    ],
    ...over,
  };
}

type Handler = (args: Record<string, unknown>) => unknown;

function backend(handlers: Record<string, Handler> = {}) {
  mocks.invoke.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
    if (command in handlers) return handlers[command](args);
    if (command === "typst_toolchain_status") return status();
    if (command === "latex_engine_info") return { kind: "none", lualatex: null, tlmgr: null, latexmk: null, version: "" };
    if (command === "tlmgr_installed" || command === "tex_distributions") return [];
    if (command === "tinytex_install_state") return { partial_download_bytes: 0 };
    return null;
  });
}

function calls(command: string) {
  return mocks.invoke.mock.calls.filter(([name]) => name === command);
}

async function openTypstTab() {
  const user = userEvent.setup();
  render(<EngineSection />);
  await user.click(screen.getByTestId("engines-tab-typst"));
  return user;
}

const row = (version: string) => screen.findByTestId(`typst-version-row-${version}`);

beforeEach(() => {
  vi.clearAllMocks();
  resetDisplayHomes();
  backend();
  useEngineStore.setState({ info: null, loaded: true, installing: false, installPhase: null, progress: null });
  useSettingsStore.setState({ settingsScrollTarget: null });
  useTypstToolchainStore.setState({ status: null, loading: false, loadFailed: false, install: null, busy: false });
});

describe("Typst tab", () => {
  it("shows the bundled version and every version newest first with its date and size", async () => {
    await openTypstTab();
    const bundled = await screen.findByTestId("typst-engine-bundled");
    expect(bundled).toHaveTextContent(copy.name);
    expect(await within(bundled).findByText("Typst 0.15.1")).toBeInTheDocument();
    const rows = await screen.findAllByTestId(/^typst-version-row-/);
    expect(rows.map((element) => element.dataset.testid)).toEqual([
      "typst-version-row-0.15.1",
      "typst-version-row-0.14.2",
      "typst-version-row-0.13.1",
    ]);
    const released = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(Date.parse("2026-03-01"));
    expect(rows[1]).toHaveTextContent(fill(copy.versions.released, { date: released }));
    expect(rows[1]).toHaveTextContent(formatDownloadSize(9_800_000));
    expect(rows[0]).toHaveTextContent(copy.versions.source.bundled);
    expect(rows[0]).toHaveTextContent(copy.versions.default);
    expect(rows[2]).toHaveTextContent(copy.versions.source.downloaded);
    expect(screen.queryByTestId("typst-engine-system")).not.toBeInTheDocument();
  });

  it("names the Tinymist each installed Typst version uses", async () => {
    backend({
      typst_toolchain_status: () =>
        status({
          versions: [
            { version: "0.15.1", releasedAt: "2026-08-01", inCatalog: true, sources: ["bundled"], downloadBytes: 1, tinymistVersion: "0.15.8" },
            { version: "0.14.2", releasedAt: "2026-03-01", inCatalog: true, sources: [], downloadBytes: 1, tinymistVersion: "0.14.20" },
            { version: "0.13.1", releasedAt: "2025-03-07", inCatalog: true, sources: ["downloaded"], downloadBytes: 1, tinymistVersion: "0.13.30" },
          ],
        }),
    });
    await openTypstTab();
    expect(await row("0.15.1")).toHaveTextContent(fill(copy.versions.tinymist, { version: "0.15.8" }));
    expect(await row("0.13.1")).toHaveTextContent(fill(copy.versions.tinymist, { version: "0.13.30" }));
    expect(await row("0.14.2")).not.toHaveTextContent(fill(copy.versions.tinymist, { version: "0.14.20" }));
  });

  it("installs a version that is not installed and shows its progress", async () => {
    let report: (progress: TypstInstallProgress) => void = () => {};
    let finish: (value: TypstToolchainStatus) => void = () => {};
    backend({
      install_typst_version: (args) => {
        const channel = args.onProgress as { onmessage: (progress: TypstInstallProgress) => void };
        report = (progress) => channel.onmessage(progress);
        return new Promise<TypstToolchainStatus>((resolve) => {
          finish = resolve;
        });
      },
    });
    const user = await openTypstTab();
    const target = await row("0.14.2");
    expect(within(target).queryByRole("radio")).not.toBeInTheDocument();
    await user.click(within(target).getByRole("button", { name: fill(copy.versions.installAria, { version: "0.14.2" }) }));
    expect(calls("install_typst_version")[0][1]).toMatchObject({ version: "0.14.2" });
    report({ version: "0.14.2", phase: "downloading", receivedBytes: 40, totalBytes: 100 });
    expect(await within(target).findByText(fill(copy.progress.downloading, { percent: 40 }))).toBeInTheDocument();
    expect(within(target).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
    expect(
      within(await row("0.13.1")).getByRole("button", { name: fill(copy.versions.removeAria, { version: "0.13.1" }) }),
    ).toBeDisabled();
    finish(
      status({
        versions: status().versions.map((entry) =>
          entry.version === "0.14.2" ? { ...entry, sources: ["downloaded"] } : entry,
        ),
      }),
    );
    expect(await within(target).findByText(copy.versions.source.downloaded)).toBeInTheDocument();
    expect(within(target).queryByRole("progressbar")).not.toBeInTheDocument();
    expect(within(target).getByRole("radio", { name: fill(copy.versions.setDefault, { version: "0.14.2" }) })).toBeInTheDocument();
    expect(mocks.errorUnique).not.toHaveBeenCalled();
  });

  it("holds every install while the backend reports one running", async () => {
    backend({ typst_toolchain_status: () => status({ installing: "0.14.2" }) });
    await openTypstTab();
    const target = await row("0.14.2");
    await waitFor(() =>
      expect(within(target).getByRole("button", { name: fill(copy.versions.installAria, { version: "0.14.2" }) })).toBeDisabled(),
    );
  });

  it("removes a downloaded version", async () => {
    backend({ remove_typst_version: () => status({ versions: status().versions.slice(0, 2) }) });
    const user = await openTypstTab();
    const target = await row("0.13.1");
    await user.click(within(target).getByRole("button", { name: fill(copy.versions.removeAria, { version: "0.13.1" }) }));
    expect(calls("remove_typst_version")[0][1]).toEqual({ version: "0.13.1" });
    await waitFor(() => expect(screen.queryByTestId("typst-version-row-0.13.1")).not.toBeInTheDocument());
  });

  it("removes the language server downloads that no installed version needs", async () => {
    backend({
      typst_toolchain_status: () => status({ unusedTinymist: ["0.12.22", "0.11.32"] }),
      remove_unused_tinymist_downloads: () => status({ unusedTinymist: [] }),
    });
    const user = await openTypstTab();
    const cleanup = await screen.findByTestId("typst-tinymist-cleanup");
    expect(cleanup).toHaveTextContent(fill(copy.languageServer.unused_other, { count: 2 }));
    await user.click(within(cleanup).getByRole("button", { name: copy.languageServer.remove }));
    expect(calls("remove_unused_tinymist_downloads")).toHaveLength(1);
    await waitFor(() => expect(screen.queryByTestId("typst-tinymist-cleanup")).not.toBeInTheDocument());
    expect(mocks.successUnique).toHaveBeenCalledTimes(1);
    expect(mocks.successUnique.mock.calls[0][1]).toBe(fill(copy.languageServer.removed_other, { count: 2 }));
    expect(mocks.errorUnique).not.toHaveBeenCalled();
  });

  it("offers no clean-up when every language server download is in use", async () => {
    await openTypstTab();
    expect(await row("0.15.1")).toBeInTheDocument();
    expect(screen.queryByTestId("typst-tinymist-cleanup")).not.toBeInTheDocument();
  });

  it("reports a clean-up that failed and keeps the offer", async () => {
    backend({
      typst_toolchain_status: () => status({ unusedTinymist: ["0.12.22"] }),
      remove_unused_tinymist_downloads: () => {
        throw new Error("in use");
      },
    });
    const user = await openTypstTab();
    const cleanup = await screen.findByTestId("typst-tinymist-cleanup");
    expect(cleanup).toHaveTextContent(fill(copy.languageServer.unused_one, { count: 1 }));
    await user.click(within(cleanup).getByRole("button", { name: copy.languageServer.remove }));
    await waitFor(() => expect(mocks.errorUnique).toHaveBeenCalledTimes(1));
    expect(mocks.errorUnique.mock.calls[0][1]).toContain(copy.error.removeTinymist);
    expect(screen.getByTestId("typst-tinymist-cleanup")).toBeInTheDocument();
    expect(mocks.successUnique).not.toHaveBeenCalled();
  });

  it("refuses to remove the default version", async () => {
    backend({
      typst_toolchain_status: () => status({ defaultChoice: "0.13.1", defaultVersion: "0.13.1" }),
    });
    const user = await openTypstTab();
    const target = await row("0.13.1");
    expect(target).toHaveTextContent(copy.versions.default);
    const remove = within(target).getByRole("button", { name: fill(copy.versions.removeAria, { version: "0.13.1" }) });
    expect(remove).toHaveAttribute("aria-disabled", "true");
    await user.hover(remove);
    expect(await screen.findByText(copy.versions.removeDefault, { selector: "[role=tooltip]" })).toBeInTheDocument();
    await user.click(remove);
    expect(calls("remove_typst_version")).toHaveLength(0);
  });

  it("switches the default and follows the bundled version with no fixed choice", async () => {
    backend({
      set_default_typst_version: (args) =>
        args.version === null
          ? status()
          : status({ defaultChoice: args.version as string, defaultVersion: args.version as string }),
    });
    const user = await openTypstTab();
    const target = await row("0.13.1");
    await user.click(within(target).getByRole("radio", { name: fill(copy.versions.setDefault, { version: "0.13.1" }) }));
    expect(calls("set_default_typst_version")[0][1]).toEqual({ version: "0.13.1" });
    await waitFor(() =>
      expect(within(target).getByRole("radio", { name: fill(copy.versions.setDefault, { version: "0.13.1" }) })).toBeChecked(),
    );
    await user.click(screen.getByRole("radio", { name: fill(copy.versions.setDefault, { version: "0.15.1" }) }));
    expect(calls("set_default_typst_version")[1][1]).toEqual({ version: null });
  });

  it("shows a Typst found on this computer with its version and path", async () => {
    backend({
      display_homes: () => ["/Users/ada"],
      typst_toolchain_status: () =>
        status({
          system: { version: "0.13.1", path: "/Users/ada/.cargo/bin/typst" },
          versions: [
            ...status().versions.slice(0, 2),
            { version: "0.13.1", releasedAt: "2025-03-07", inCatalog: true, sources: ["system"], downloadBytes: 8_200_000 },
          ],
        }),
    });
    await openTypstTab();
    const system = await screen.findByTestId("typst-engine-system");
    expect(system).toHaveTextContent(copy.system.name);
    expect(system).toHaveTextContent("Typst 0.13.1");
    expect(await within(system).findByText("~/.cargo/bin/typst")).toBeInTheDocument();
    const target = await row("0.13.1");
    expect(target).toHaveTextContent(copy.versions.source.system);
    expect(within(target).queryByRole("button", { name: fill(copy.versions.removeAria, { version: "0.13.1" }) })).not.toBeInTheDocument();
    expect(within(target).getByRole("radio")).toBeInTheDocument();
  });

  it("says when the versions cannot be read and tries again", async () => {
    let fail = true;
    backend({
      typst_toolchain_status: () => {
        if (fail) throw new Error("offline");
        return status();
      },
    });
    const user = await openTypstTab();
    expect(await screen.findByText(copy.error.load)).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole("button", { name: enCommon.actions.retry }));
    expect(await row("0.15.1")).toBeInTheDocument();
    expect(mocks.errorUnique).not.toHaveBeenCalled();
  });

  it("opens on the Typst tab when asked from the compile menu", async () => {
    useSettingsStore.setState({ settingsScrollTarget: TYPST_SETTINGS_TARGET });
    render(<EngineSection />);
    expect(await screen.findByTestId("typst-engine-bundled")).toBeInTheDocument();
    expect(useSettingsStore.getState().settingsScrollTarget).toBeNull();
  });
});
