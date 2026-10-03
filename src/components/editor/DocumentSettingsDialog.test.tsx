// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };

interface FakeState {
  projectId: string;
  mainDoc: string;
  activePath: string;
  engine?: { id: string; tex_flavor?: string };
  engineLoaded?: boolean;
  files: Record<string, { content: string }>;
  setContent: ReturnType<typeof vi.fn>;
  saveFile: ReturnType<typeof vi.fn>;
  writeProjectFile: ReturnType<typeof vi.fn>;
  refreshEngine: ReturnType<typeof vi.fn>;
}

const mocks = vi.hoisted(() => ({
  view: null as null | { state: { doc: { toString: () => string } }; dispatch: ReturnType<typeof vi.fn> },
  state: {} as FakeState,
  readFile: vi.fn(),
  success: vi.fn(),
  log: vi.fn(),
  readOnly: vi.fn(),
  options: vi.fn(),
  setOptions: vi.fn(),
  fonts: vi.fn(),
}));

vi.mock("@/components/editor/cm/controller", () => ({ getEditorView: () => mocks.view }));
vi.mock("@/lib/tauri", () => ({ readFileContent: mocks.readFile }));
vi.mock("@/lib/toast", () => ({ toast: { success: mocks.success } }));
vi.mock("@/lib/log", () => ({ logError: mocks.log }));
vi.mock("@/lib/read-only-files", () => ({ readOnlyEditMessage: mocks.readOnly }));
vi.mock("@/lib/typst-options", () => ({
  typstProjectOptions: mocks.options,
  setTypstProjectOptions: mocks.setOptions,
  typstProjectFonts: mocks.fonts,
}));
vi.mock("@/store/files", () => ({
  useFilesStore: Object.assign((select: (value: FakeState) => unknown) => select(mocks.state), {
    getState: () => mocks.state,
  }),
}));

import { DocumentSettingsDialog } from "./DocumentSettingsDialog";

const settings = enEditor.typstSettings;
const doc = enEditor.documentSettings;

const MAIN = [
  '#import "lib.typ": conf',
  '#set page(paper: "a4", margin: (x: 2cm, y: 3cm))',
  '#set text(size: 11pt, lang: "de")',
  "= Intro",
  "",
].join("\n");

const FONTS = {
  version: "0.14.0",
  sourcesListed: true,
  systemFonts: true,
  families: [
    { name: "Inter", sources: [{ kind: "system", path: "/Library/Fonts/Inter.ttf" }] },
    { name: "Libertinus Serif", sources: [{ kind: "embedded", path: null }] },
    { name: "Brand Sans", sources: [{ kind: "project", path: "fonts/Brand.otf" }] },
  ],
};

function editorWith(text: string) {
  mocks.view = { state: { doc: { toString: () => text } }, dispatch: vi.fn() };
  return mocks.view;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.view = null;
  mocks.state = {
    projectId: "paper",
    mainDoc: "main.typ",
    activePath: "main.typ",
    files: {},
    setContent: vi.fn(),
    saveFile: vi.fn(),
    writeProjectFile: vi.fn(),
    refreshEngine: vi.fn(async () => {}),
  };
  mocks.readOnly.mockReturnValue(null);
  mocks.options.mockResolvedValue({ fontPaths: [], systemFonts: true, reproducible: false, inputs: {}, variants: {} });
  mocks.setOptions.mockResolvedValue({});
  mocks.fonts.mockResolvedValue(FONTS);
});

describe("DocumentSettingsDialog for Typst", () => {
  it("shows the values the main file sets and locks the ones it cannot edit", async () => {
    editorWith(MAIN);
    render(<DocumentSettingsDialog onClose={vi.fn()} />);
    expect(await screen.findByLabelText(settings.fields.fontSize)).toHaveValue("11pt");
    expect(screen.getByLabelText(settings.fields.lang)).toHaveValue("de");
    const margin = screen.getByLabelText(settings.fields.margin);
    expect(margin).toHaveValue("(x: 2cm, y: 3cm)");
    expect(margin).toBeDisabled();
    expect(screen.getByText(settings.locked.expression)).toBeVisible();
    expect(screen.queryByText(settings.templateNotice)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: settings.apply })).toBeDisabled();
  });

  it("writes minimal edits into the open editor", async () => {
    const view = editorWith(MAIN);
    const onClose = vi.fn();
    render(<DocumentSettingsDialog onClose={onClose} />);
    fireEvent.change(await screen.findByLabelText(settings.fields.fontSize), { target: { value: "12pt" } });
    fireEvent.change(screen.getByLabelText(settings.fields.leading), { target: { value: "0.7em" } });
    fireEvent.click(screen.getByRole("button", { name: settings.apply }));
    await waitFor(() => expect(view.dispatch).toHaveBeenCalledOnce());
    const { changes } = view.dispatch.mock.calls[0][0];
    const sizeAt = MAIN.indexOf("11pt");
    const importEnd = MAIN.indexOf("\n") + 1;
    expect(changes).toEqual([
      { from: importEnd, to: importEnd, insert: "#set par(leading: 0.7em)\n" },
      { from: sizeAt, to: sizeAt + 4, insert: "12pt" },
    ]);
    expect(mocks.success).toHaveBeenCalledWith(settings.applied);
    expect(onClose).toHaveBeenCalled();
  });

  it("blocks invalid values with a reason", async () => {
    editorWith(MAIN);
    render(<DocumentSettingsDialog onClose={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText(settings.fields.fontSize), { target: { value: "big" } });
    expect(screen.getByText(settings.invalid.length)).toBeVisible();
    expect(screen.getByRole("button", { name: settings.apply })).toBeDisabled();
  });

  it("explains template documents and saves a main file that is not open in the editor", async () => {
    mocks.state.activePath = "chapters/one.typ";
    mocks.readFile.mockResolvedValue('#import "lib.typ": conf\n#show: conf.with(title: [T])\n= Intro\n');
    render(<DocumentSettingsDialog onClose={vi.fn()} />);
    expect(await screen.findByText(settings.templateNotice)).toBeVisible();
    fireEvent.change(screen.getByLabelText(settings.fields.region), { target: { value: "us" } });
    fireEvent.click(screen.getByRole("button", { name: settings.apply }));
    await waitFor(() => expect(mocks.state.writeProjectFile).toHaveBeenCalledOnce());
    expect(mocks.state.writeProjectFile).toHaveBeenCalledWith(
      "paper",
      "main.typ",
      '#import "lib.typ": conf\n#show: conf.with(title: [T])\n#set text(region: "US")\n= Intro\n',
    );
  });

  it("refuses to edit a read-only main file", async () => {
    const view = editorWith(MAIN);
    mocks.readOnly.mockReturnValue("This folder is read-only.");
    render(<DocumentSettingsDialog onClose={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText(settings.fields.fontSize), { target: { value: "12pt" } });
    fireEvent.click(screen.getByRole("button", { name: settings.apply }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This folder is read-only.");
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it("picks the body font from the font list and still accepts a typed name", async () => {
    const view = editorWith(MAIN);
    render(<DocumentSettingsDialog onClose={vi.fn()} />);
    const font = await screen.findByLabelText(settings.fields.font);
    fireEvent.focus(font);
    await waitFor(() => expect(mocks.fonts).toHaveBeenCalledWith("paper"));
    const listbox = await screen.findByRole("listbox", { name: doc.availableFonts });
    expect(within(listbox).getByText("Libertinus Serif")).toBeInTheDocument();
    expect(within(listbox).getByText(enEditor.typstFonts.sources.embedded)).toBeInTheDocument();
    fireEvent.change(font, { target: { value: "int" } });
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options).toHaveLength(1);
    fireEvent.click(options[0]);
    expect(font).toHaveValue("Inter");
    fireEvent.click(screen.getByRole("button", { name: settings.apply }));
    await waitFor(() => expect(view.dispatch).toHaveBeenCalledOnce());
    expect(JSON.stringify(view.dispatch.mock.calls[0][0].changes)).toContain('font: \\"Inter\\"');
  });

  it("edits build variants and saves them with Apply", async () => {
    editorWith(MAIN);
    mocks.options.mockResolvedValue({
      fontPaths: [],
      systemFonts: true,
      reproducible: false,
      inputs: {},
      variants: { final: { draft: "false" } },
    });
    const onClose = vi.fn();
    render(<DocumentSettingsDialog onClose={onClose} />);
    const section = await screen.findByTestId("document-settings-variants");
    const name = await within(section).findByLabelText(enEditor.typstVariants.name);
    expect(name).toHaveValue("final");
    fireEvent.change(name, { target: { value: "camera-ready" } });
    fireEvent.click(screen.getByRole("button", { name: settings.apply }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.setOptions).toHaveBeenCalledWith("paper", { variants: { "camera-ready": { draft: "false" } } });
    expect(mocks.state.refreshEngine).toHaveBeenCalled();
    expect(mocks.success).toHaveBeenCalledOnce();
  });

  it("keeps the dialog open when a variant is invalid", async () => {
    editorWith(MAIN);
    const onClose = vi.fn();
    render(<DocumentSettingsDialog onClose={onClose} />);
    const section = await screen.findByTestId("document-settings-variants");
    await within(section).findByText(enEditor.typstVariants.empty);
    fireEvent.click(within(section).getByRole("button", { name: enEditor.typstVariants.add }));
    fireEvent.click(screen.getByRole("button", { name: settings.apply }));
    expect(await within(section).findByText(enEditor.typstVariants.keyInvalid)).toBeVisible();
    expect(mocks.setOptions).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("DocumentSettingsDialog for LaTeX", () => {
  beforeEach(() => {
    mocks.state.mainDoc = "main.tex";
    mocks.state.activePath = "main.tex";
    mocks.state.engine = { id: "latex" };
    mocks.state.engineLoaded = true;
  });

  it("reads the preamble and adds geometry for a new margin", async () => {
    const text = "\\documentclass[11pt]{article}\n\\usepackage{amsmath}\n\\begin{document}\nHi\n\\end{document}\n";
    const view = editorWith(text);
    render(<DocumentSettingsDialog onClose={vi.fn()} />);
    expect(await screen.findByText(doc.latexDescription.replace("{{file}}", "main.tex"))).toBeVisible();
    expect(screen.getByLabelText(settings.fields.fontSize)).toHaveTextContent("11pt");
    expect(screen.queryByTestId("document-settings-variants")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(settings.fields.margin), { target: { value: "2cm" } });
    fireEvent.change(screen.getByLabelText(settings.fields.lang), { target: { value: "british" } });
    fireEvent.click(screen.getByRole("button", { name: settings.apply }));
    await waitFor(() => expect(view.dispatch).toHaveBeenCalledOnce());
    const at = text.indexOf("\\begin");
    expect(view.dispatch.mock.calls[0][0].changes).toEqual([
      { from: at, to: at, insert: "\\usepackage[margin=2cm]{geometry}\n\\usepackage[british]{babel}\n" },
    ]);
  });

  it("explains classes that own the layout and compilers without system fonts", async () => {
    mocks.state.engine = { id: "latexmk", tex_flavor: "pdflatex" };
    editorWith("\\documentclass[conference]{IEEEtran}\n\\begin{document}\n\\end{document}\n");
    render(<DocumentSettingsDialog onClose={vi.fn()} />);
    expect(await screen.findByText(doc.classNotice.replace("{{name}}", "IEEEtran"))).toBeVisible();
    expect(screen.getByLabelText(settings.fields.margin)).toBeDisabled();
    expect(screen.getByText(doc.locked.class.replace("{{name}}", "IEEEtran"))).toBeVisible();
    expect(screen.getByLabelText(settings.fields.font)).toBeDisabled();
    expect(screen.getByText(doc.locked.engine)).toBeVisible();
  });

  it("lists only fonts LaTeX can load", async () => {
    editorWith("\\documentclass{article}\n\\begin{document}\n\\end{document}\n");
    render(<DocumentSettingsDialog onClose={vi.fn()} />);
    fireEvent.focus(await screen.findByLabelText(settings.fields.font));
    const listbox = await screen.findByRole("listbox", { name: doc.availableFonts });
    await within(listbox).findByText("Inter");
    expect(within(listbox).queryByText("Brand Sans")).not.toBeInTheDocument();
    expect(within(listbox).queryByText("Libertinus Serif")).not.toBeInTheDocument();
  });

  it("reports a main file without \\documentclass", async () => {
    editorWith("\\section{Intro}\n");
    render(<DocumentSettingsDialog onClose={vi.fn()} />);
    expect(await screen.findByText(doc.noDocumentClass)).toBeVisible();
  });
});

describe("DocumentSettingsDialog for Markdown", () => {
  beforeEach(() => {
    mocks.state.mainDoc = "main.md";
    mocks.state.activePath = "notes.md";
    mocks.state.engine = { id: "markdown" };
    mocks.state.engineLoaded = true;
  });

  it("creates the front matter in a main file that is not open", async () => {
    mocks.readFile.mockResolvedValue("# Title\n\nBody\n");
    render(<DocumentSettingsDialog onClose={vi.fn()} />);
    expect(await screen.findByText(doc.noFrontMatter)).toBeVisible();
    fireEvent.change(screen.getByLabelText(settings.fields.margin), { target: { value: "2cm" } });
    fireEvent.change(screen.getByLabelText(settings.fields.lang), { target: { value: "en-GB" } });
    fireEvent.change(screen.getByLabelText(settings.fields.leading), { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: settings.apply }));
    await waitFor(() => expect(mocks.state.writeProjectFile).toHaveBeenCalledOnce());
    expect(mocks.state.writeProjectFile).toHaveBeenCalledWith(
      "paper",
      "main.md",
      "---\ngeometry: margin=2cm\nlang: en-GB\nlinestretch: 1.5\n---\n\n# Title\n\nBody\n",
    );
  });

  it("explains a front matter that never closes", async () => {
    mocks.readFile.mockResolvedValue("---\ntitle: Draft\n\n# Title\n");
    render(<DocumentSettingsDialog onClose={vi.fn()} />);
    expect(await screen.findByText(doc.unclosedFrontMatter)).toBeVisible();
  });

  it("blocks an invalid language tag", async () => {
    mocks.readFile.mockResolvedValue("---\nlang: en\n---\n");
    render(<DocumentSettingsDialog onClose={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText(settings.fields.lang), { target: { value: "en_GB" } });
    expect(screen.getByText(doc.invalid.markdownLang)).toBeVisible();
    expect(screen.getByRole("button", { name: settings.apply })).toBeDisabled();
  });
});
