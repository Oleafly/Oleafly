// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enPreview from "@/i18n/locales/en/preview.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };

const actions = vi.hoisted(() => ({
  acceptCompileOffer: vi.fn(),
  downloadMissingTypst: vi.fn(async () => {}),
  switchToDefaultTypst: vi.fn(async () => {}),
}));

vi.mock("@/store/compile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/compile")>()),
  ...actions,
}));

import { LATEX_ENGINE } from "@/lib/document-engine";
import type { TypstToolchainStatus } from "@/lib/tauri";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
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
});
