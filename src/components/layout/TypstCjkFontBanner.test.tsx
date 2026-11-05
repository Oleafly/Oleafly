// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { LATEX_ENGINE } from "@/lib/document-engine";
import type { CompileError, ComponentInfo, DocumentEngineDescriptor } from "@/lib/tauri";
import { useCompileStore } from "@/store/compile";
import { useFilesStore } from "@/store/files";
import { useFontPacksStore } from "@/store/font-packs";
import { useToastStore } from "@/store/toast";
import { useTypstDocumentPanelStore } from "@/store/typst-document-panels";
import { TypstCjkFontBanner } from "./TypstCjkFontBanner";

const coverage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/typst-options", () => ({ typstGlyphCoverage: coverage }));

const copy = enShell.typstCjkFonts;
const recompile = vi.fn(async () => undefined);
const refreshEngine = vi.fn(async () => undefined);
const install = vi.fn(async (_id: string) => true);

const TYPST_ENGINE = {
  ...LATEX_ENGINE,
  id: "typst",
  label: "Typst",
  source_format: "typst",
} as unknown as DocumentEngineDescriptor;

function cjkPack(installed = false): ComponentInfo {
  return {
    id: "typst-cjk",
    label: "Chinese, Japanese and Korean",
    description: "",
    approx_bytes: 153_946_822,
    license: null,
    installed,
    kind: "typst-font",
    families: ["Noto Serif CJK SC"],
  };
}

function project(projectId: string, text: string, engine = TYPST_ENGINE, pack = cjkPack()) {
  useFilesStore.setState({
    projectId,
    engine,
    refreshEngine,
  } as unknown as ReturnType<typeof useFilesStore.getState>);
  useCompileStore.setState({
    compiledSources: { fsEpoch: 0, texts: { "main.typ": text } },
    recompile,
  } as unknown as ReturnType<typeof useCompileStore.getState>);
  useFontPacksStore.setState({ packs: [pack], status: "ready", installing: null, install });
}

beforeEach(() => {
  localStorage.clear();
  coverage.mockReset().mockResolvedValue({ uncovered: "你好", packsApply: true });
  recompile.mockClear();
  refreshEngine.mockClear();
  install.mockReset().mockResolvedValue(true);
  useToastStore.getState().reset();
  useCompileStore.setState({ errors: [] });
});

describe("TypstCjkFontBanner", () => {
  it("offers the font pack when no font covers the document's CJK text and installs it in one click", async () => {
    const user = userEvent.setup();
    project("cjk-install", "= 你好\nHello");
    render(<TypstCjkFontBanner />);

    const banner = await screen.findByTestId("typst-cjk-font-banner");
    expect(banner).toHaveTextContent(copy.message);
    expect(coverage).toHaveBeenCalledWith("cjk-install", "你好");
    await user.click(screen.getByRole("button", { name: copy.downloadSize.replace("{{size}}", "154 MB") }));

    expect(install).toHaveBeenCalledWith("typst-cjk");
    await waitFor(() => expect(recompile).toHaveBeenCalledTimes(1));
    expect(refreshEngine).toHaveBeenCalledTimes(1);
  });

  it("stays closed for that project once the user closes it", async () => {
    const user = userEvent.setup();
    project("cjk-close", "中文");
    const { unmount } = render(<TypstCjkFontBanner />);
    await user.click(await screen.findByRole("button", { name: enCommon.actions.close }));
    expect(screen.queryByTestId("typst-cjk-font-banner")).toBeNull();
    unmount();

    render(<TypstCjkFontBanner />);
    await Promise.resolve();
    expect(screen.queryByTestId("typst-cjk-font-banner")).toBeNull();
    expect(localStorage.getItem("oleafly.typstCjkFonts.cjk-close")).not.toBeNull();
  });

  it("checks fonts once per project however often the same characters compile", async () => {
    project("cjk-once", "中文");
    const { rerender } = render(<TypstCjkFontBanner />);
    await screen.findByTestId("typst-cjk-font-banner");
    useCompileStore.setState({ compiledSources: { fsEpoch: 1, texts: { "main.typ": "中文 again" } } });
    rerender(<TypstCjkFontBanner />);
    await screen.findByTestId("typst-cjk-font-banner");
    expect(coverage).toHaveBeenCalledTimes(1);
  });

  it("checks again when the document gains characters the last check did not cover", async () => {
    coverage.mockResolvedValueOnce({ uncovered: "", packsApply: true });
    project("cjk-grows", "中文");
    const { rerender } = render(<TypstCjkFontBanner />);
    await waitFor(() => expect(coverage).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("typst-cjk-font-banner")).toBeNull();

    coverage.mockResolvedValueOnce({ uncovered: "한", packsApply: true });
    useCompileStore.setState({ compiledSources: { fsEpoch: 1, texts: { "main.typ": "中文 한국어" } } });
    rerender(<TypstCjkFontBanner />);

    expect(await screen.findByTestId("typst-cjk-font-banner")).toBeInTheDocument();
    expect(coverage).toHaveBeenLastCalledWith("cjk-grows", expect.stringContaining("한"));
  });

  it("stays hidden without CJK text, once the pack is installed, outside Typst, or when fonts cover the text", async () => {
    project("latin-only", "= Results\nThe café is open.");
    const { unmount } = render(<TypstCjkFontBanner />);
    await Promise.resolve();
    expect(coverage).not.toHaveBeenCalled();
    unmount();

    project("installed", "中文", TYPST_ENGINE, cjkPack(true));
    render(<TypstCjkFontBanner />).unmount();
    project("latex", "中文", LATEX_ENGINE);
    render(<TypstCjkFontBanner />).unmount();
    expect(coverage).not.toHaveBeenCalled();

    coverage.mockResolvedValue({ uncovered: "", packsApply: true });
    project("covered", "中文");
    render(<TypstCjkFontBanner />).unmount();
    coverage.mockResolvedValue({ uncovered: "中文", packsApply: false });
    project("system-fonts-off", "中文");
    render(<TypstCjkFontBanner />);
    await waitFor(() => expect(coverage).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("typst-cjk-font-banner")).toBeNull();
  });

  it("says so once when the download fails", async () => {
    const user = userEvent.setup();
    install.mockResolvedValue(false);
    project("cjk-fail", "中文");
    render(<TypstCjkFontBanner />);
    await user.click(await screen.findByRole("button", { name: /154 MB/u }));

    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([enEditor.log.fontPackFailed]),
    );
    expect(recompile).not.toHaveBeenCalled();
  });
});

describe("Typst glyph warnings on the banner", () => {
  const glyphWarning = (code: string, params: Record<string, string> = {}): CompileError => ({
    line: null,
    file: null,
    message: "no font has these characters: ก",
    kind: "warning",
    explanation: `Explained ${code}`,
    code,
    params,
  });

  it("shows why text is missing when packs cannot help and points to Document settings", async () => {
    const user = userEvent.setup();
    coverage.mockResolvedValue({ uncovered: "中文", packsApply: false });
    project("sealed-glyphs", "中文");
    useCompileStore.setState({ errors: [glyphWarning("typst.missing_glyphs_sealed", { sample: "中 文" })] });
    render(<TypstCjkFontBanner />);

    const banner = await screen.findByTestId("typst-glyph-banner");
    expect(banner).toHaveTextContent("Explained typst.missing_glyphs_sealed");
    expect(screen.queryByTestId("typst-cjk-font-banner")).toBeNull();
    expect(screen.queryByRole("button", { name: /Download/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: enEditor.typstSettings.title }));
    expect(useTypstDocumentPanelStore.getState().panel).toBe("settings");
    useTypstDocumentPanelStore.setState({ panel: null });
  });

  it("warns about a placeholder font on a Mac where system fonts claim to cover the text", async () => {
    coverage.mockResolvedValue({ uncovered: "", packsApply: true });
    project("placeholder-glyphs", "한글");
    useCompileStore.setState({ errors: [glyphWarning("typst.placeholder_glyphs")] });
    render(<TypstCjkFontBanner />);
    expect(await screen.findByTestId("typst-glyph-banner")).toHaveTextContent(
      "Explained typst.placeholder_glyphs",
    );
  });

  it("downloads the pack the warning names and compiles again", async () => {
    const user = userEvent.setup();
    project("emoji-glyphs", "🚀", TYPST_ENGINE, {
      ...cjkPack(true),
      id: "typst-icons",
      approx_bytes: 13_292_209,
    });
    useCompileStore.setState({
      errors: [glyphWarning("typst.missing_glyphs_pack", { sample: "🚀", pack: "typst-icons" })],
    });
    render(<TypstCjkFontBanner />);
    await screen.findByTestId("typst-glyph-banner");
    expect(screen.queryByRole("button", { name: /Download/ })).toBeNull();

    useFontPacksStore.setState({
      packs: [{ ...cjkPack(false), id: "typst-icons", approx_bytes: 13_292_209 }],
    });
    await user.click(await screen.findByRole("button", { name: /Download/ }));
    expect(install).toHaveBeenCalledWith("typst-icons");
    await waitFor(() => expect(recompile).toHaveBeenCalledTimes(1));
  });

  it("gives way to the CJK download and respects the closed banner", async () => {
    const user = userEvent.setup();
    project("cjk-pack-first", "中文");
    useCompileStore.setState({
      errors: [glyphWarning("typst.missing_glyphs_pack", { sample: "中 文", pack: "typst-cjk" })],
    });
    const { unmount } = render(<TypstCjkFontBanner />);
    await screen.findByTestId("typst-cjk-font-banner");
    expect(screen.queryByTestId("typst-glyph-banner")).toBeNull();
    unmount();

    coverage.mockResolvedValue({ uncovered: "ก", packsApply: true });
    project("closed-glyphs", "ก");
    useCompileStore.setState({ errors: [glyphWarning("typst.missing_glyphs", { sample: "ก" })] });
    const closed = render(<TypstCjkFontBanner />);
    await screen.findByTestId("typst-glyph-banner");
    await user.click(screen.getByRole("button", { name: enCommon.actions.close }));
    expect(screen.queryByTestId("typst-glyph-banner")).toBeNull();
    closed.unmount();
    render(<TypstCjkFontBanner />);
    expect(screen.queryByTestId("typst-glyph-banner")).toBeNull();
  });

  it("keeps its own closed state, separate from the CJK banner", async () => {
    coverage.mockResolvedValue({ uncovered: "中文", packsApply: false });
    project("closed-cjk-sealed", "中文");
    localStorage.setItem("oleafly.typstCjkFonts.closed-cjk-sealed", "hidden");
    useCompileStore.setState({ errors: [glyphWarning("typst.missing_glyphs_sealed", { sample: "中 文" })] });
    render(<TypstCjkFontBanner />);
    expect(await screen.findByTestId("typst-glyph-banner")).toHaveTextContent(
      "Explained typst.missing_glyphs_sealed",
    );
  });

  it("does not repeat the CJK download offer after that banner was closed", async () => {
    project("closed-cjk-offer", "中文");
    localStorage.setItem("oleafly.typstCjkFonts.closed-cjk-offer", "hidden");
    useCompileStore.setState({
      errors: [glyphWarning("typst.missing_glyphs_pack", { sample: "中 文", pack: "typst-cjk" })],
    });
    render(<TypstCjkFontBanner />);
    await Promise.resolve();
    expect(screen.queryByTestId("typst-glyph-banner")).toBeNull();
  });

  it("shows again when different characters go missing, and stays closed when the same ones return", async () => {
    const user = userEvent.setup();
    project("glyph-samples", "ก");
    useCompileStore.setState({ errors: [glyphWarning("typst.missing_glyphs", { sample: "ก" })] });
    const { rerender } = render(<TypstCjkFontBanner />);
    await screen.findByTestId("typst-glyph-banner");
    await user.click(screen.getByRole("button", { name: enCommon.actions.close }));
    expect(screen.queryByTestId("typst-glyph-banner")).toBeNull();

    useCompileStore.setState({ errors: [glyphWarning("typst.missing_glyphs", { sample: "ব" })] });
    rerender(<TypstCjkFontBanner />);
    await screen.findByTestId("typst-glyph-banner");

    useCompileStore.setState({ errors: [glyphWarning("typst.missing_glyphs", { sample: "ก" })] });
    rerender(<TypstCjkFontBanner />);
    await waitFor(() => expect(screen.queryByTestId("typst-glyph-banner")).toBeNull());
  });

  it("closing a glyph warning leaves the CJK banner alone", async () => {
    const user = userEvent.setup();
    project("glyph-then-cjk", "ก");
    useCompileStore.setState({ errors: [glyphWarning("typst.missing_glyphs", { sample: "ก" })] });
    render(<TypstCjkFontBanner />);
    await screen.findByTestId("typst-glyph-banner");
    await user.click(screen.getByRole("button", { name: enCommon.actions.close }));
    expect(localStorage.getItem("oleafly.typstCjkFonts.glyph-then-cjk")).toBeNull();
  });

  it("ignores other warnings and other engines", async () => {
    project("other-warning", "Hello");
    useCompileStore.setState({ errors: [glyphWarning("typst.unknown_font")] });
    const { unmount } = render(<TypstCjkFontBanner />);
    expect(screen.queryByTestId("typst-glyph-banner")).toBeNull();
    unmount();

    project("latex-glyphs", "Hello", LATEX_ENGINE);
    useCompileStore.setState({ errors: [glyphWarning("typst.missing_glyphs")] });
    render(<TypstCjkFontBanner />);
    expect(screen.queryByTestId("typst-glyph-banner")).toBeNull();
  });
});
