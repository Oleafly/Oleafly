// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enPreview from "@/i18n/locales/en/preview.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };

const actions = vi.hoisted(() => ({
  acceptCompileOffer: vi.fn(),
  downloadMissingTypst: vi.fn(async () => {}),
  switchToDefaultTypst: vi.fn(async () => {}),
  installMissingTex: vi.fn(async () => {}),
  switchToTectonic: vi.fn(async () => {}),
}));

vi.mock("@/store/compile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/compile")>()),
  ...actions,
}));

import { useCollabEditorGate } from "@/lib/collab-live-bridge";
import { LATEX_ENGINE } from "@/lib/document-engine";
import type { TypstToolchainStatus } from "@/lib/tauri";
import { useCompileStore } from "@/store/compile";
import { useEngineStore } from "@/store/engine";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useTypstToolchainStore } from "@/store/typst-toolchain";
import { CompileOfferButton } from "./CompileOfferButton";

const copy = enPreview.actions;

function toolchain(versions: Array<{ version: string; inCatalog: boolean }>, defaultVersion = "0.15.1"): TypstToolchainStatus {
  return {
    bundledVersion: "0.15.1",
    defaultVersion,
    defaultChoice: null,
    system: null,
    installing: null,
    versions: versions.map((entry) => ({ ...entry, releasedAt: null, sources: [], downloadBytes: 1 })),
  };
}

function useEngine(id: string, typstMissing: string | null = null) {
  useFilesStore.setState({
    projectId: "paper",
    engine: { ...LATEX_ENGINE, id, typst_missing: typstMissing } as never,
  });
}

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockClear();
  useCompileStore.setState({ offer: null });
  useTypstToolchainStore.setState({
    status: toolchain([{ version: "0.13.1", inCatalog: true }]),
    install: null,
    ensureLoaded: vi.fn(async () => null),
  } as never);
  useEngine("latex");
});

describe("CompileOfferButton", () => {
  it("shows nothing without a matching offer", () => {
    const { container, rerender } = render(<CompileOfferButton placement="preview" />);
    expect(container).toBeEmptyDOMElement();

    useCompileStore.setState({ offer: { kind: "engine-gap", projectId: "other", findings: [] } });
    rerender(<CompileOfferButton placement="preview" />);
    expect(container).toBeEmptyDOMElement();

    useEngine("latexmk");
    useCompileStore.setState({ offer: { kind: "engine-gap", projectId: "paper", findings: [] } });
    rerender(<CompileOfferButton placement="preview" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers an engine choice for the bundled engine", () => {
    const offer = { kind: "engine-gap" as const, projectId: "paper", findings: [] };
    useCompileStore.setState({ offer });
    render(<CompileOfferButton placement="toolbar" />);

    fireEvent.click(screen.getByTestId("toolbar-compile-offer"));

    expect(screen.getByTestId("toolbar-compile-offer")).toHaveTextContent(copy.chooseEngine);
    expect(actions.acceptCompileOffer).toHaveBeenCalledWith(offer);
  });

  it("offers Japanese support on a TeX that can install it", () => {
    useEngine("latexmk");
    const offer = {
      kind: "tex-packages",
      projectId: "paper",
      packages: ["collection-langjapanese"],
    } as const;
    useCompileStore.setState({ offer: { ...offer, packages: [...offer.packages] } });
    render(<CompileOfferButton placement="preview" />);
    fireEvent.click(screen.getByTestId("preview-compile-offer"));
    expect(screen.getByTestId("preview-compile-offer")).toHaveTextContent(copy.installJapanese);
    expect(actions.acceptCompileOffer).toHaveBeenCalled();
  });

  it("names the compiler an Auto build should switch to", () => {
    useEngine("latexmk");
    useCompileStore.setState({
      offer: { kind: "switch-compiler", projectId: "paper", compiler: "lualatex", label: "LuaLaTeX" },
    });
    render(<CompileOfferButton placement="log" />);
    fireEvent.click(screen.getByTestId("log-compile-offer"));
    expect(screen.getByTestId("log-compile-offer")).toHaveTextContent(
      copy.useCompiler.replace("{{compiler}}", "LuaLaTeX"),
    );
    expect(actions.acceptCompileOffer).toHaveBeenCalled();
  });

  it("offers to install the missing packages for a system TeX", () => {
    useEngine("latexmk");
    useCompileStore.setState({ offer: { kind: "missing-packages", projectId: "paper", packages: ["siunitx"] } });
    const { rerender } = render(<CompileOfferButton placement="log" />);
    expect(screen.getByTestId("log-compile-offer")).toHaveTextContent(
      copy.installPackages_one.replace("{{name}}", "siunitx"),
    );

    useCompileStore.setState({ offer: { kind: "missing-packages", projectId: "paper", packages: ["a", "b"] } });
    rerender(<CompileOfferButton placement="log" />);
    expect(screen.getByTestId("log-compile-offer")).toHaveTextContent(
      copy.installPackages_other.replace("{{count}}", "2"),
    );
  });

  it("downloads a pinned Typst version or switches to the default one", () => {
    useEngine("typst", "0.13.1");
    render(<CompileOfferButton placement="preview" />);

    fireEvent.click(screen.getByTestId("preview-compile-offer"));
    fireEvent.click(screen.getByTestId("preview-compile-offer-default"));

    expect(screen.getByTestId("preview-compile-offer")).toHaveTextContent(copy.downloadTypst.replace("{{version}}", "0.13.1"));
    expect(actions.downloadMissingTypst).toHaveBeenCalledWith("paper", "0.13.1");
    expect(actions.switchToDefaultTypst).toHaveBeenCalledWith("paper");
    expect(useTypstToolchainStore.getState().ensureLoaded).toHaveBeenCalled();
  });

  it("follows a missing-version offer and shows the install progress", () => {
    useEngine("typst");
    useCompileStore.setState({ offer: { kind: "typst-version-missing", projectId: "paper", version: "0.13.1" } as never });
    useTypstToolchainStore.setState({
      install: { version: "0.13.1", phase: "downloading", receivedBytes: 50, totalBytes: 100 },
    } as never);
    render(<CompileOfferButton placement="toolbar" />);

    const download = screen.getByTestId("toolbar-compile-offer");
    expect(download).toHaveTextContent(enSettings.engine.typst.progress.downloading.replace("{{percent}}", "50"));
    expect(download).toBeDisabled();
    expect(screen.getByTestId("toolbar-compile-offer-default")).toBeDisabled();
  });

  it("only offers the default when the version cannot be downloaded or already is the default", () => {
    useEngine("typst", "0.12.0");
    const { rerender } = render(<CompileOfferButton placement="preview" />);
    expect(screen.queryByTestId("preview-compile-offer")).toBeNull();
    expect(screen.getByTestId("preview-compile-offer-default")).toBeInTheDocument();

    useEngine("typst", "0.15.1");
    useTypstToolchainStore.setState({ status: toolchain([{ version: "0.15.1", inCatalog: true }]) } as never);
    rerender(<CompileOfferButton placement="preview" />);
    expect(screen.getByTestId("preview-compile-offer")).toBeInTheDocument();
    expect(screen.queryByTestId("preview-compile-offer-default")).toBeNull();
  });

  it("offers a download before the toolchain status has loaded", () => {
    useEngine("typst", "0.14.0");
    useTypstToolchainStore.setState({ status: null } as never);
    render(<CompileOfferButton placement="preview" />);

    expect(screen.getByTestId("preview-compile-offer")).toBeEnabled();
    expect(screen.queryByTestId("preview-compile-offer-default")).toBeNull();
  });

  describe("missing TeX", () => {
    const offer = { kind: "tex-missing" as const, projectId: "paper" };

    beforeEach(() => {
      useCollabEditorGate.setState({ projectId: null, viewer: false, locked: false, connecting: false });
      useEngine("latexmk");
      useCompileStore.setState({ offer });
      useEngineStore.setState({
        info: null,
        loaded: true,
        installing: false,
        installPhase: null,
        progress: null,
        partialDownloadBytes: 0,
      });
      useSettingsStore.setState({ settingsOpen: false, settingsInitialSection: "general" });
    });

    it("installs TinyTeX, goes back to Tectonic or opens the engine settings", () => {
      render(<CompileOfferButton placement="preview" />);

      const install = screen.getByTestId("preview-compile-offer");
      expect(install).toHaveTextContent(enShell.enginePicker.tinytex.download);
      fireEvent.click(install);
      fireEvent.click(screen.getByTestId("preview-compile-offer-tectonic"));
      fireEvent.click(screen.getByTestId("preview-compile-offer-settings"));

      expect(actions.installMissingTex).toHaveBeenCalledWith("paper");
      expect(actions.switchToTectonic).toHaveBeenCalledWith("paper");
      expect(useSettingsStore.getState().settingsOpen).toBe(true);
      expect(useSettingsStore.getState().settingsInitialSection).toBe("engine");
    });

    it("says a switch to Tectonic changes a shared project for everyone", () => {
      useCollabEditorGate.setState({ projectId: "paper", viewer: false, locked: false, connecting: false });
      render(<CompileOfferButton placement="preview" />);
      expect(screen.getByTestId("preview-compile-offer-tectonic")).toHaveTextContent(copy.useTectonicForEveryone);
      expect(screen.getByTestId("preview-compile-offer")).toBeInTheDocument();
    });

    it("keeps the switch to Tectonic from a viewer of a shared project", () => {
      useCollabEditorGate.setState({ projectId: "paper", viewer: true, locked: false, connecting: false });
      render(<CompileOfferButton placement="preview" />);
      expect(screen.queryByTestId("preview-compile-offer-tectonic")).toBeNull();
      expect(screen.getByTestId("preview-compile-offer")).toBeInTheDocument();
    });

    it("shows the download progress and resumes a partial download", () => {
      useEngineStore.setState({ partialDownloadBytes: 42_000_000 });
      const { rerender } = render(<CompileOfferButton placement="toolbar" />);
      expect(screen.getByTestId("toolbar-compile-offer")).toHaveTextContent(
        enShell.enginePicker.tinytex.resume.replace("{{megabytes}}", "42"),
      );
      expect(screen.queryByTestId("toolbar-compile-offer-tectonic")).toBeNull();

      useEngineStore.setState({ installing: true, installPhase: "extract" });
      rerender(<CompileOfferButton placement="toolbar" />);
      expect(screen.getByTestId("toolbar-compile-offer")).toBeDisabled();
    });

    it("leaves only the settings when TinyTeX is already what's running", () => {
      useEngineStore.setState({ info: { kind: "tinytex" } as never });
      render(<CompileOfferButton placement="log" />);
      expect(screen.queryByTestId("log-compile-offer")).toBeNull();
      expect(screen.getByTestId("log-compile-offer-settings")).toBeInTheDocument();
    });

    it("hides the download when TinyTeX can't take over from a complete distribution", () => {
      useEngineStore.setState({
        info: { kind: "system", tex_complete: true, latexmk_blocker: null } as never,
      });
      render(<CompileOfferButton placement="preview" />);
      expect(screen.queryByTestId("preview-compile-offer")).toBeNull();
      expect(screen.getByTestId("preview-compile-offer-settings")).toBeInTheDocument();
    });

    it("keeps the download for a complete MiKTeX that can't run latexmk without Perl", () => {
      useEngineStore.setState({
        info: {
          kind: "system",
          tex_complete: true,
          latexmk_blocker: { code: "tex.latexmk_needs_perl", params: {} },
        } as never,
      });
      render(<CompileOfferButton placement="preview" />);
      expect(screen.getByTestId("preview-compile-offer")).toHaveTextContent(enShell.enginePicker.tinytex.download);
    });

    it("keeps the download for a distribution that isn't complete", () => {
      useEngineStore.setState({
        info: { kind: "system", tex_complete: false, latexmk_blocker: null } as never,
      });
      render(<CompileOfferButton placement="preview" />);
      expect(screen.getByTestId("preview-compile-offer")).toBeInTheDocument();
    });

    it("disappears once the project leaves latexmk", () => {
      useEngine("latex");
      const { container } = render(<CompileOfferButton placement="preview" />);
      expect(container).toBeEmptyDOMElement();
    });

    it("offers TinyTeX to a Quarto project but not the switch to Tectonic", () => {
      useEngine("quarto");
      render(<CompileOfferButton placement="preview" />);
      fireEvent.click(screen.getByTestId("preview-compile-offer"));
      expect(actions.installMissingTex).toHaveBeenCalledWith("paper");
      expect(screen.queryByTestId("preview-compile-offer-tectonic")).toBeNull();
      expect(screen.getByTestId("preview-compile-offer-settings")).toBeInTheDocument();
    });
  });
});
