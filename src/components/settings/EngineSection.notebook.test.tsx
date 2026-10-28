// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  NotebookInstallProgress,
  NotebookToolchainStatus,
  NotebookToolStatus,
} from "@/lib/notebook-commands";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  errorUnique: vi.fn(),
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
    successUnique: vi.fn(),
  },
}));
vi.mock("@/features/pandoc", () => ({ ensurePandoc: vi.fn(async () => true) }));

import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { resetDisplayHomes } from "@/lib/display-path";
import { formatDownloadSize } from "@/lib/download-size";
import { useEngineStore } from "@/store/engine";
import { useSettingsStore } from "@/store/settings";
import {
  CALEPIN_SETTINGS_TARGET,
  QUARTO_SETTINGS_TARGET,
  useNotebookToolchainStore,
} from "@/store/notebook-toolchain";
import { useTypstToolchainStore } from "@/store/typst-toolchain";
import { EngineSection } from "@/components/settings/EngineSection";

const copy = enSettings.engine.notebook;
const fill = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce((text, [key, value]) => text.replace(`{{${key}}}`, String(value)), template);

const systemQuarto = { path: "/opt/quarto/bin/quarto", version: "1.9.4", source: "system" as const };
const managedQuarto = { path: "/data/oleafly/tools/quarto/bin/quarto", version: "1.10.19", source: "managed" as const };

function tool(name: "quarto" | "calepin", over: Partial<NotebookToolStatus> = {}): NotebookToolStatus {
  return {
    tool: name,
    pinnedVersion: name === "quarto" ? "1.10.19" : "0.0.61",
    active: null,
    system: null,
    managed: null,
    offered: true,
    downloadBytes: name === "quarto" ? 128_000_000 : 9_400_000,
    license: "MIT",
    installing: false,
    ...over,
  };
}

function status(
  quarto: Partial<NotebookToolStatus> = {},
  calepin: Partial<NotebookToolStatus> = {},
): NotebookToolchainStatus {
  return {
    quarto: tool("quarto", quarto),
    calepin: tool("calepin", calepin),
    runtimes: [
      { name: "r", path: "/usr/local/bin/R", version: "4.5.1" },
      { name: "python", path: "/usr/bin/python3", version: "3.13.2" },
      { name: "julia", path: null, version: null },
    ],
  };
}

type Handler = (args: Record<string, unknown>) => unknown;

function backend(handlers: Record<string, Handler> = {}) {
  mocks.invoke.mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
    if (command in handlers) return handlers[command](args);
    if (command === "notebook_toolchain_status") return status();
    if (command === "latex_engine_info") return { kind: "none", lualatex: null, tlmgr: null, latexmk: null, version: "" };
    if (command === "tlmgr_installed" || command === "tex_distributions") return [];
    if (command === "tinytex_install_state") return { partial_download_bytes: 0 };
    return null;
  });
}

function calls(command: string) {
  return mocks.invoke.mock.calls.filter(([name]) => name === command);
}

async function openTab(tab: "quarto" | "calepin") {
  const user = userEvent.setup();
  render(<EngineSection />);
  await user.click(screen.getByTestId(`engines-tab-${tab}`));
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDisplayHomes();
  backend();
  useEngineStore.setState({ info: null, loaded: true, installing: false, installPhase: null, progress: null });
  useSettingsStore.setState({ settingsScrollTarget: null });
  useTypstToolchainStore.setState({ status: null, loading: false, loadFailed: false, install: null, busy: false });
  useNotebookToolchainStore.setState({ status: null, loading: false, loadFailed: false, installs: {}, removing: null });
});

describe("Quarto tab", () => {
  it("says Quarto is missing and offers the pinned version with its size and license", async () => {
    await openTab("quarto");
    const active = await screen.findByTestId("quarto-engine-active");
    expect(active).toHaveTextContent(copy.active.missing);
    expect(active.querySelector("[data-slot=check-badge]")).toBeNull();
    const download = screen.getByTestId("quarto-engine-download");
    expect(download).toHaveTextContent("Quarto 1.10.19");
    expect(download).toHaveTextContent(enSettings.engine.quarto.downloadDetail);
    expect(download).toHaveTextContent(fill(copy.download.license, { license: "MIT" }));
    expect(download).not.toHaveTextContent(copy.download.optional);
    expect(
      within(download).getByRole("button", {
        name: fill(copy.download.action, { tool: "Quarto", version: "1.10.19", size: formatDownloadSize(128_000_000) }),
      }),
    ).toBeEnabled();
  });

  it("downloads only on the click and shows each phase while it installs", async () => {
    let report: (progress: NotebookInstallProgress) => void = () => {};
    let finish: (value: NotebookToolchainStatus) => void = () => {};
    backend({
      install_notebook_tool: (args) => {
        const channel = args.onProgress as { onmessage: (progress: NotebookInstallProgress) => void };
        report = (progress) => channel.onmessage(progress);
        return new Promise<NotebookToolchainStatus>((resolve) => {
          finish = resolve;
        });
      },
    });
    const user = await openTab("quarto");
    const download = await screen.findByTestId("quarto-engine-download");
    expect(calls("install_notebook_tool")).toHaveLength(0);
    await user.click(within(download).getByRole("button"));
    expect(calls("install_notebook_tool")).toEqual([["install_notebook_tool", expect.objectContaining({ tool: "quarto" })]]);
    expect(await screen.findByTestId("quarto-engine-progress")).toHaveTextContent(copy.progress.starting);
    report({ tool: "quarto", phase: "downloading", receivedBytes: 64, totalBytes: 128 });
    await waitFor(() =>
      expect(screen.getByTestId("quarto-engine-progress")).toHaveTextContent(
        fill(copy.progress.downloading, { percent: 50 }),
      ),
    );
    finish(status({ managed: managedQuarto, active: managedQuarto }));
    const active = await screen.findByText("Quarto 1.10.19", { selector: "[data-testid=quarto-engine-active] span" });
    expect(active).toBeInTheDocument();
    expect(screen.queryByTestId("quarto-engine-download")).not.toBeInTheDocument();
    expect(screen.getByTestId("quarto-engine-active")).toHaveTextContent(copy.source.managed);
  });

  it("names the copy in use with its path, and removes the managed one", async () => {
    backend({
      notebook_toolchain_status: () => status({ managed: managedQuarto, active: managedQuarto }),
      remove_notebook_tool: () => status(),
    });
    const user = await openTab("quarto");
    const active = await screen.findByTestId("quarto-engine-active");
    await waitFor(() => expect(active).toHaveTextContent("Quarto 1.10.19"));
    expect(active).toHaveTextContent(enSettings.engine.quarto.detail);
    expect(active).toHaveTextContent(managedQuarto.path);
    expect(active.querySelector("[data-slot=check-badge][data-tone=success]")).not.toBeNull();
    await user.click(within(active).getByRole("button", { name: fill(copy.removeAria, { tool: "Quarto" }) }));
    await waitFor(() => expect(calls("remove_notebook_tool")).toEqual([["remove_notebook_tool", { tool: "quarto" }]]));
    expect(await screen.findByTestId("quarto-engine-download")).toBeInTheDocument();
  });

  it("uses the Quarto on this computer and keeps the download optional", async () => {
    backend({ notebook_toolchain_status: () => status({ system: systemQuarto, active: systemQuarto }) });
    await openTab("quarto");
    const active = await screen.findByTestId("quarto-engine-active");
    await waitFor(() => expect(active).toHaveTextContent("Quarto 1.9.4"));
    expect(active).toHaveTextContent(copy.source.system);
    expect(within(active).queryByRole("button")).toBeNull();
    expect(screen.getByTestId("quarto-engine-download")).toHaveTextContent(copy.download.optional);
  });

  it("lists an idle managed copy with its own remove action", async () => {
    backend({
      notebook_toolchain_status: () => status({ system: systemQuarto, active: systemQuarto, managed: managedQuarto }),
    });
    await openTab("quarto");
    const managed = await screen.findByTestId("quarto-engine-managed");
    expect(managed).toHaveTextContent(copy.managedIdle);
    expect(within(managed).getByRole("button", { name: fill(copy.removeAria, { tool: "Quarto" }) })).toBeEnabled();
    expect(screen.queryByTestId("quarto-engine-download")).not.toBeInTheDocument();
  });

  it("says when Oleafly cannot download Quarto for this computer", async () => {
    backend({ notebook_toolchain_status: () => status({ offered: false }) });
    await openTab("quarto");
    const download = await screen.findByTestId("quarto-engine-download");
    await waitFor(() => expect(download).toHaveTextContent(fill(copy.download.notOffered, { tool: "Quarto" })));
    expect(within(download).queryByRole("button")).toBeNull();
  });

  it("lists R, Python and Julia and never offers to install them", async () => {
    await openTab("quarto");
    const languages = await screen.findByTestId("notebook-languages");
    const r = within(languages).getByTestId("notebook-language-r");
    expect(r).toHaveTextContent("R");
    expect(r).toHaveTextContent("4.5.1");
    expect(r).toHaveTextContent("/usr/local/bin/R");
    expect(r.querySelector("[data-slot=check-badge][data-tone=success]")).not.toBeNull();
    const julia = within(languages).getByTestId("notebook-language-julia");
    expect(julia).toHaveTextContent(copy.languages.notFound);
    expect(julia.querySelector("[data-slot=check-badge]")).toBeNull();
    expect(within(languages).queryByRole("button")).toBeNull();
    expect(screen.getByText(new RegExp(copy.languages.note))).toBeInTheDocument();
  });

  it("offers a retry when the tools could not be checked", async () => {
    let fail = true;
    backend({
      notebook_toolchain_status: () => {
        if (fail) throw new Error("probe failed");
        return status();
      },
    });
    const user = await openTab("quarto");
    expect(await screen.findByText(copy.error.load)).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole("button", { name: enCommon.actions.retry }));
    expect(await screen.findByTestId("quarto-engine-active")).toBeInTheDocument();
  });

  it("opens on the Quarto tab from its settings link", async () => {
    useSettingsStore.setState({ settingsScrollTarget: QUARTO_SETTINGS_TARGET });
    render(<EngineSection />);
    expect(await screen.findByTestId("quarto-engine-active")).toBeInTheDocument();
    expect(useSettingsStore.getState().settingsScrollTarget).toBeNull();
  });
});

describe("Calepin tab", () => {
  it("says Calepin renders with the built-in Typst and offers its download", async () => {
    await openTab("calepin");
    const download = await screen.findByTestId("calepin-engine-download");
    expect(download).toHaveTextContent("Calepin 0.0.61");
    expect(
      within(download).getByRole("button", {
        name: fill(copy.download.action, { tool: "Calepin", version: "0.0.61", size: formatDownloadSize(9_400_000) }),
      }),
    ).toBeEnabled();
    expect(screen.getByText(enSettings.engine.calepin.typstNote)).toBeInTheDocument();
    expect(screen.getByTestId("notebook-languages")).toBeInTheDocument();
  });

  it("opens on the Calepin tab from its settings link", async () => {
    useSettingsStore.setState({ settingsScrollTarget: CALEPIN_SETTINGS_TARGET });
    render(<EngineSection />);
    expect(await screen.findByTestId("calepin-engine-active")).toBeInTheDocument();
  });
});
