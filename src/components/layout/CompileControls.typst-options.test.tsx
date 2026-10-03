// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { LATEX_ENGINE } from "@/lib/document-engine";
import type { DocumentEngineDescriptor } from "@/lib/tauri";
import type { TypstOptionsDescriptor } from "@oleafly/backend-port";
import { CompileControlsView, type CompileControlsViewProps } from "./CompileControls";

const fonts = enShell.compile.typstFonts;
const build = enShell.compile.typstBuild;
const variant = enShell.compile.typstVariant;

const NEWEST_FLAGS = ["--creation-timestamp", "--deps", "--features", "--font-path", "--ignore-system-fonts", "--input", "--pages"];

function options(over: Partial<TypstOptionsDescriptor> = {}): TypstOptionsDescriptor {
  return {
    system_fonts: true,
    reproducible: false,
    variants: [],
    font_dirs: [],
    flags: NEWEST_FLAGS,
    output_formats: ["html", "pdf", "png", "svg"],
    pdf_standards: ["a-2b", "ua-1"],
    ...over,
  };
}

function typstEngine(typstOptions: TypstOptionsDescriptor | null = options()): DocumentEngineDescriptor {
  return {
    ...LATEX_ENGINE,
    id: "typst",
    label: "Typst",
    source_format: "typst",
    main_document: "main.typ",
    source_extensions: ["typ"],
    capabilities: { ...LATEX_ENGINE.capabilities, formatting_profile: "typst", supports_offline: false },
    typst_resolved: { version: "0.15.1", source: "bundled" },
    typst_options: typstOptions,
  };
}

const setTypstOptions = vi.fn(async () => {});
const setTypstVariant = vi.fn();

function renderView(engine: DocumentEngineDescriptor, over: Partial<CompileControlsViewProps> = {}) {
  return render(
    <CompileControlsView
      engine={engine}
      engineLoaded
      setEngine={vi.fn(async () => {})}
      recompile={vi.fn()}
      stopCompile={vi.fn(async () => {})}
      autoCompile={false}
      setAutoCompile={vi.fn()}
      compileMode="normal"
      setCompileMode={vi.fn()}
      checkSyntaxBeforeCompile
      setCheckSyntaxBeforeCompile={vi.fn()}
      stopOnFirstError={false}
      setStopOnFirstError={vi.fn()}
      status="idle"
      compileRevision={0}
      setTypstVersion={vi.fn(async () => {})}
      setTypstOptions={setTypstOptions}
      setTypstVariant={setTypstVariant}
      {...over}
    />,
  );
}

async function openOptions() {
  const user = userEvent.setup();
  await user.click(screen.getByLabelText(enShell.compile.options));
  await screen.findByRole("menu");
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Typst fonts and builds in the compile menu", () => {
  it("is not offered for a LaTeX project", async () => {
    renderView(LATEX_ENGINE);
    await openOptions();
    expect(screen.queryByText(fonts.title)).not.toBeInTheDocument();
    expect(screen.queryByText(build.title)).not.toBeInTheDocument();
    expect(screen.queryByTestId("typst-system-fonts")).not.toBeInTheDocument();
  });

  it("offers every Typst choice as a radio, never a check mark", async () => {
    renderView(typstEngine(options({ variants: ["draft"] })), { autoCompile: true });
    await openOptions();
    const menu = screen.getByRole("menu");
    expect(within(menu).queryAllByRole("menuitemcheckbox")).toHaveLength(0);
    for (const id of ["typst-system-fonts", "typst-project-fonts", "typst-standard-build", "typst-reproducible", "typst-variant-none", "typst-variant-draft"]) {
      expect(screen.getByTestId(id)).toHaveAttribute("role", "menuitemradio");
    }
  });

  it("puts the groups in the same order as LaTeX's, with the actions last", async () => {
    renderView(typstEngine(options({ variants: ["draft"] })));
    await openOptions();
    const text = screen.getByRole("menu").textContent ?? "";
    const order = [
      enShell.compile.autoCompile.title,
      enShell.compile.typstVersion.title,
      fonts.title,
      build.title,
      variant.title,
      enShell.compile.stop,
      enShell.compile.fromScratch,
    ].map((label) => text.indexOf(label));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("leaves the font list and the variant editor to Document settings", async () => {
    renderView(typstEngine(options({ variants: ["draft"] })));
    await openOptions();
    expect(screen.queryByTestId("typst-font-list")).not.toBeInTheDocument();
    expect(screen.queryByTestId("typst-variants-edit")).not.toBeInTheDocument();
    expect(screen.queryByText("Font list")).not.toBeInTheDocument();
    expect(screen.queryByText("Edit variants")).not.toBeInTheDocument();
  });

  it("switches to project fonts only", async () => {
    renderView(typstEngine());
    const user = await openOptions();
    expect(screen.getByTestId("typst-system-fonts")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("typst-project-fonts")).toHaveAttribute("aria-checked", "false");
    await user.click(screen.getByTestId("typst-project-fonts"));
    expect(setTypstOptions).toHaveBeenCalledExactlyOnceWith({ systemFonts: false });
  });

  it("goes back to system fonts", async () => {
    renderView(typstEngine(options({ system_fonts: false })));
    const user = await openOptions();
    expect(screen.getByTestId("typst-project-fonts")).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByTestId("typst-system-fonts"));
    expect(setTypstOptions).toHaveBeenCalledExactlyOnceWith({ systemFonts: true });
  });

  it("ignores a font choice that is already in effect", async () => {
    renderView(typstEngine());
    const user = await openOptions();
    await user.click(screen.getByTestId("typst-system-fonts"));
    expect(setTypstOptions).not.toHaveBeenCalled();
  });

  it("turns a reproducible build on", async () => {
    renderView(typstEngine());
    const user = await openOptions();
    expect(screen.getByTestId("typst-standard-build")).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByTestId("typst-reproducible"));
    expect(setTypstOptions).toHaveBeenCalledExactlyOnceWith({ reproducible: true });
  });

  it("holds project fonts while a reproducible build is on and goes back to a standard build", async () => {
    renderView(typstEngine(options({ reproducible: true })));
    const user = await openOptions();
    expect(screen.getByTestId("typst-project-fonts")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("typst-system-fonts")).toHaveAttribute("data-disabled");
    expect(screen.getByTestId("typst-reproducible")).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByTestId("typst-standard-build"));
    expect(setTypstOptions).toHaveBeenCalledExactlyOnceWith({ reproducible: false });
  });

  it("disables what an old Typst cannot do", async () => {
    renderView(typstEngine(options({ flags: ["--font-path", "--input"] })));
    await openOptions();
    expect(screen.getByTestId("typst-system-fonts")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("typst-project-fonts")).toHaveAttribute("data-disabled");
    expect(screen.getByTestId("typst-reproducible")).toHaveAttribute("data-disabled");
    expect(screen.getByTestId("typst-standard-build")).not.toHaveAttribute("data-disabled");
    expect(screen.getAllByText(fonts.unsupported)).toHaveLength(2);
  });

  it("hides the variant choice until the project has variants", async () => {
    renderView(typstEngine());
    await openOptions();
    expect(screen.queryByText(variant.title)).not.toBeInTheDocument();
    expect(screen.queryByTestId("typst-variant-none")).not.toBeInTheDocument();
  });

  it("picks a variant and goes back to none", async () => {
    const { unmount } = renderView(typstEngine(options({ variants: ["draft", "final"] })), {
      typstVariant: null,
    });
    let user = await openOptions();
    expect(screen.getByText(variant.title)).toBeInTheDocument();
    expect(screen.getByTestId("typst-variant-none")).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByTestId("typst-variant-final"));
    expect(setTypstVariant).toHaveBeenCalledWith("final");
    unmount();

    renderView(typstEngine(options({ variants: ["draft", "final"] })), { typstVariant: "final" });
    user = await openOptions();
    expect(screen.getByTestId("typst-variant-final")).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByTestId("typst-variant-none"));
    expect(setTypstVariant).toHaveBeenLastCalledWith(null);
  });

  it("stays hidden while the backend has not described the Typst options", async () => {
    renderView(typstEngine(null));
    await openOptions();
    expect(screen.queryByTestId("typst-system-fonts")).not.toBeInTheDocument();
    expect(screen.queryByTestId("typst-reproducible")).not.toBeInTheDocument();
  });
});
