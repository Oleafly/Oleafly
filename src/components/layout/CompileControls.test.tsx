// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { importCompatFinding } from "@oleafly/latex";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enPreview from "@/i18n/locales/en/preview.json" with { type: "json" };
import { useCompileStore, type CompileOffer } from "@/store/compile";
import { useEnginePickerStore } from "@/store/engine-picker";
import { useFilesStore } from "@/store/files";
import { usePreviewDetachedStore } from "@/store/preview-detached";
import { useSettingsStore } from "@/store/settings";

import { CompileControls } from "./CompileControls";

describe("compile button focus", () => {
  beforeEach(() => {
    useFilesStore.setState({ projectId: "p1", engineLoaded: true });
    useCompileStore.setState({ status: "idle" });
    useSettingsStore.setState({ viewMode: "editor" });
    usePreviewDetachedStore.setState({ projectId: null });
  });

  it("keeps the caret where it was when Compile is pressed", () => {
    const recompile = vi.fn();
    useCompileStore.setState({ recompile });
    render(<CompileControls />);
    const button = screen.getByTestId("compile-button");

    const accepted = fireEvent.mouseDown(button);

    expect(accepted).toBe(false);
    expect(recompile).not.toHaveBeenCalled();

    fireEvent.click(button);
    expect(recompile).toHaveBeenCalledTimes(1);
  });

  it("keeps the editor layout when recompiling with a detached preview", () => {
    const recompile = vi.fn();
    useCompileStore.setState({ recompile });
    usePreviewDetachedStore.setState({ projectId: "p1" });
    render(<CompileControls />);
    fireEvent.click(screen.getByTestId("compile-button"));
    expect(recompile).toHaveBeenCalledOnce();
    expect(useSettingsStore.getState().viewMode).toBe("editor");
    expect(usePreviewDetachedStore.getState().projectId).toBe("p1");
  });

  it("shows the attached preview when compiling from the editor", () => {
    useCompileStore.setState({ recompile: vi.fn() });
    render(<CompileControls />);
    fireEvent.click(screen.getByTestId("compile-button"));
    expect(useSettingsStore.getState().viewMode).toBe("split");
  });
});

describe("compile offer while the preview is hidden", () => {
  const OFFER_ID = "toolbar-compile-offer";

  function failWithOffer(engineId: "latex" | "latexmk", offer: CompileOffer) {
    useFilesStore.setState({
      projectId: "p1",
      engineLoaded: true,
      engine: { ...useFilesStore.getState().engine, id: engineId },
    });
    useCompileStore.setState({ status: "error", offer });
    useEnginePickerStore.setState({ open: false, source: "manual", findings: [] });
  }

  const engineGap: CompileOffer = { kind: "engine-gap", projectId: "p1", findings: [importCompatFinding("minted")] };

  beforeEach(() => {
    useSettingsStore.setState({ viewMode: "editor" });
    usePreviewDetachedStore.setState({ projectId: null });
  });

  it("puts the engine choice from an automatic compile next to Compile in editor-only view", () => {
    failWithOffer("latex", engineGap);
    render(<CompileControls />);

    const offer = screen.getByTestId(OFFER_ID);
    expect(offer).toHaveTextContent(enPreview.actions.chooseEngine);
    fireEvent.click(offer);

    const picker = useEnginePickerStore.getState();
    expect(picker.open).toBe(true);
    expect(picker.source).toBe("compile-failure");
    expect(picker.findings.map((finding) => finding.id)).toEqual(["minted"]);
  });

  it("leaves the offer to the preview when the preview is on screen", () => {
    failWithOffer("latex", engineGap);
    useSettingsStore.setState({ viewMode: "split" });
    render(<CompileControls />);

    expect(screen.queryByTestId(OFFER_ID)).toBeNull();
  });

  it("keeps the offer in the main window while the preview is in its own window", () => {
    failWithOffer("latex", engineGap);
    usePreviewDetachedStore.setState({ projectId: "p1" });
    render(<CompileControls />);

    expect(screen.getByTestId(OFFER_ID)).toHaveTextContent(enPreview.actions.chooseEngine);
  });

  it("offers the missing files on system LaTeX", () => {
    failWithOffer("latexmk", { kind: "missing-packages", projectId: "p1", packages: ["minted.sty"] });
    render(<CompileControls />);

    expect(screen.getByTestId(OFFER_ID)).toHaveTextContent("minted.sty");
  });

  it("drops an offer that belongs to another project or engine", () => {
    failWithOffer("latexmk", engineGap);
    const { unmount } = render(<CompileControls />);
    expect(screen.queryByTestId(OFFER_ID)).toBeNull();
    unmount();

    failWithOffer("latex", { ...engineGap, projectId: "p2" });
    render(<CompileControls />);
    expect(screen.queryByTestId(OFFER_ID)).toBeNull();
  });
});
