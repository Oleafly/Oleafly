// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TexDistribution } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  ensurePandoc: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: mocks.invoke }));
vi.mock("@/lib/toast", () => ({
  toast: { error: mocks.error, info: mocks.info, success: mocks.success },
}));
vi.mock("@/features/pandoc", () => ({ ensurePandoc: mocks.ensurePandoc }));

import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { useEngineStore } from "@/store/engine";
import { useSettingsStore } from "@/store/settings";
import { EngineSection } from "@/components/settings/EngineSection";

const engineCopy = enSettings.engine;

const systemEngine = {
  kind: "system" as const,
  lualatex: "/usr/bin/lualatex",
  tlmgr: "/usr/bin/tlmgr",
  latexmk: "/usr/bin/latexmk",
  version: "TeX Live 2026",
};

const distro = (over: Partial<TexDistribution> = {}): TexDistribution => ({
  kind: "texlive",
  label: "TeX Live 2026",
  bin_dir: "/usr/local/texlive/2026/bin",
  latexmk: "/usr/local/texlive/2026/bin/latexmk",
  tlmgr: "/usr/local/texlive/2026/bin/tlmgr",
  ...over,
});

function backend(overrides: Record<string, unknown> = {}) {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command in overrides) return overrides[command];
    if (command === "latex_engine_info") return systemEngine;
    if (command === "tlmgr_installed" || command === "tex_distributions") return [];
    if (command === "tinytex_install_state") return { partial_download_bytes: 0 };
    if (command === "has_pandoc") return true;
    return null;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  backend();
  mocks.ensurePandoc.mockResolvedValue(true);
  useEngineStore.setState({
    info: systemEngine,
    installed: [],
    userInstalled: [],
    systemInstalled: [],
    busyPkg: null,
    loaded: true,
    installing: false,
    packageError: null,
    installPhase: null,
    progress: null,
    partialDownloadBytes: 0,
  });
  useSettingsStore.setState({ defaultLatexEngine: "tectonic" });
});

describe("EngineSection LaTeX tab", () => {
  it("offers both default engines and records the choice", async () => {
    const user = userEvent.setup();
    render(<EngineSection />);

    expect(screen.getByText(engineCopy.defaultEngine.heading)).toBeInTheDocument();
    expect(screen.getByText(engineCopy.choices.tectonic.detail)).toBeInTheDocument();
    expect(screen.getByText(engineCopy.choices.latexmk.detail)).toBeInTheDocument();
    expect(screen.queryByText(engineCopy.latexmkMissing)).not.toBeInTheDocument();

    await user.click(screen.getByText(engineCopy.choices.latexmk.name));
    expect(useSettingsStore.getState().defaultLatexEngine).toBe("latexmk");
  });

  it("flags a missing latexmk on the system", async () => {
    backend({ latex_engine_info: { ...systemEngine, latexmk: null } });
    useEngineStore.setState({ info: { ...systemEngine, latexmk: null } });
    render(<EngineSection />);

    expect(await screen.findByText(engineCopy.latexmkMissing)).toBeInTheDocument();
  });

  it("says when no distribution was detected", async () => {
    render(<EngineSection />);

    expect(
      await screen.findByText(engineCopy.distributions.empty),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: engineCopy.tinytex.download }),
    ).toBeInTheDocument();
    expect(screen.getByText(engineCopy.tinytex.detail)).toBeInTheDocument();
  });

  it("describes a detected distribution and the tools it ships", async () => {
    backend({ tex_distributions: [distro()] });
    render(<EngineSection />);

    expect((await screen.findAllByText("TeX Live 2026")).length).toBeGreaterThan(0);
    expect(screen.getByText("/usr/local/texlive/2026/bin")).toBeInTheDocument();
    expect(screen.getByText("latexmk")).toBeInTheDocument();
    expect(screen.getByText("tlmgr")).toBeInTheDocument();
  });

  it("describes a distribution with neither tool", async () => {
    backend({
      tex_distributions: [
        distro({ label: "Bare TeX", latexmk: null, tlmgr: null, bin_dir: "/opt/tex" }),
      ],
    });
    render(<EngineSection />);

    expect(await screen.findByText("Bare TeX")).toBeInTheDocument();
    expect(screen.getByText("/opt/tex")).toBeInTheDocument();
    expect(screen.queryByText("tlmgr")).not.toBeInTheDocument();
  });

  it("removes a managed TinyTeX install", async () => {
    const user = userEvent.setup();
    backend({
      tex_distributions: [distro({ kind: "oleafly-tinytex", label: "TinyTeX (managed)" })],
    });
    render(<EngineSection />);

    await screen.findByText("TinyTeX (managed)");
    await user.click(screen.getByRole("button", { name: enCommon.actions.remove }));
    await waitFor(() =>
      expect(mocks.invoke.mock.calls.some(([cmd]) => cmd === "delete_tinytex")).toBe(true),
    );
  });

  it("offers to resume a partial download", async () => {
    useEngineStore.setState({ partialDownloadBytes: 120_000_000 });
    render(<EngineSection />);

    expect(
      await screen.findByRole("button", {
        name: engineCopy.tinytex.resume.replace("{{size}}", "120"),
      }),
    ).toBeInTheDocument();
  });

  it("names the install phase while TinyTeX installs", async () => {
    useEngineStore.setState({ installing: true, installPhase: "extract", progress: null });
    render(<EngineSection />);

    expect(
      await screen.findByRole("button", { name: enCore.tinytex.phase.unpacking }),
    ).toBeInTheDocument();
  });

  it("reports the tagging engine for the detected distribution", async () => {
    render(<EngineSection />);

    expect(screen.getByText(engineCopy.tagging.status.system)).toBeInTheDocument();
    expect(screen.getByText(engineCopy.tagging.hint.system)).toBeInTheDocument();
    expect(screen.getByText(systemEngine.version)).toBeInTheDocument();
  });

  it("reports no tagging engine when none is installed", async () => {
    useEngineStore.setState({
      info: { kind: "none", lualatex: null, tlmgr: null, latexmk: null, version: "" },
    });
    render(<EngineSection />);

    expect(screen.getByText(engineCopy.tagging.status.none)).toBeInTheDocument();
    expect(screen.getByText(engineCopy.tagging.hint.none)).toBeInTheDocument();
  });
});

describe("EngineSection Typst tab", () => {
  it("describes the bundled compiler", async () => {
    const user = userEvent.setup();
    render(<EngineSection />);

    await user.click(screen.getByTestId("engines-tab-typst"));
    expect(await screen.findByText(engineCopy.typst.heading)).toBeInTheDocument();
    expect(screen.getByText(engineCopy.typst.name)).toBeInTheDocument();
    expect(screen.getByText(engineCopy.typst.detail)).toBeInTheDocument();
    expect(screen.getByText(engineCopy.typst.note)).toBeInTheDocument();
  });
});

describe("EngineSection Markdown tab", () => {
  it("reports a detected pandoc", async () => {
    const user = userEvent.setup();
    render(<EngineSection />);

    await user.click(screen.getByTestId("engines-tab-markdown"));
    expect(await screen.findByText(engineCopy.markdown.heading)).toBeInTheDocument();
    expect(
      await screen.findByText(engineCopy.markdown.status.ready),
    ).toBeInTheDocument();
    expect(screen.getByText(engineCopy.markdown.tectonicDetail)).toBeInTheDocument();
    expect(screen.getByText(engineCopy.markdown.note)).toBeInTheDocument();
  });

  it("installs a missing pandoc", async () => {
    const user = userEvent.setup();
    backend({ has_pandoc: false });
    let release: (value: boolean) => void = () => {};
    mocks.ensurePandoc.mockReturnValue(
      new Promise<boolean>((resolve) => {
        release = resolve;
      }),
    );
    render(<EngineSection />);

    await user.click(screen.getByTestId("engines-tab-markdown"));
    expect(
      await screen.findByText(engineCopy.markdown.status.missing),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: engineCopy.markdown.repair }),
    );
    expect(
      await screen.findByText(engineCopy.markdown.status.installing),
    ).toBeInTheDocument();
    expect(screen.getByText(engineCopy.markdown.downloading)).toBeInTheDocument();

    release(true);
    expect(
      await screen.findByText(engineCopy.markdown.status.ready),
    ).toBeInTheDocument();
  });

  it("treats a failed pandoc probe as missing", async () => {
    const user = userEvent.setup();
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "has_pandoc") throw new Error("probe failed");
      if (command === "latex_engine_info") return systemEngine;
      if (command === "tlmgr_installed" || command === "tex_distributions") return [];
      if (command === "tinytex_install_state") return { partial_download_bytes: 0 };
      return null;
    });
    render(<EngineSection />);

    await user.click(screen.getByTestId("engines-tab-markdown"));
    const card = await screen.findByTestId("markdown-engine-pandoc");
    expect(
      within(card).getByText(engineCopy.markdown.status.missing),
    ).toBeInTheDocument();
  });
});
