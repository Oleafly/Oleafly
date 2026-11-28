// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { buildLibrary, parseSnippetFile, type ParsedSnippetFile, type SnippetOverride, type SnippetProblem } from "@oleafly/snippets";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { openSnippetSettings } from "@/features/snippets/open-settings";
import { type SnippetState, useSnippetStore } from "@/features/snippets/store";
import { useSettingsStore } from "@/store/settings";
import { SnippetsSection } from "./SnippetsSection";

const copy = enSettings.snippets;
const initial = useSnippetStore.getState();

const actions = {
  load: vi.fn(async () => undefined),
  setCollectionEnabled: vi.fn(async (_collection: string, _enabled: boolean) => undefined),
  setOverride: vi.fn(async (_change: unknown) => undefined),
  importVsCodeFile: vi.fn(async (fileName: string, text: string) => parseSnippetFile(text, fileName.replace(/\.json$/u, ""), "user")),
  saveRecord: vi.fn(async () => undefined),
  deleteRecord: vi.fn(async () => undefined),
};

function file(collection: string, layer: "user" | "pack" | "builtin", entries: Record<string, unknown>): ParsedSnippetFile {
  return parseSnippetFile(JSON.stringify(entries), collection, layer);
}

const MINE = file("my-snippets", "user", {
  "user.rtab": { name: "Results table", prefix: "rtab", body: "\\begin{table}$1\\end{table}", languages: ["latex"], where: "text" },
  "user.todo": { name: "Reviewer note", prefix: "todo", body: `\\todo{\${SELECTION}}`, languages: ["latex"], expand: "list" },
});
const FAST = file("fast-math-latex", "pack", {
  $pack: { name: "Fast math · LaTeX", source: "https://github.com/gillescastel/latex-snippets", licence: "MIT" },
  "fm.frac": { name: "Fraction", prefix: "//", body: "\\frac{$1}{$2}$0", languages: ["latex"], where: "math", expand: "auto" },
});
const TYPST = file("fast-math-typst", "pack", {
  $pack: { name: "Fast math · Typst", licence: "MIT" },
  "fmt.frac": { name: "Typst fraction", prefix: "ff", body: "($1)/($2)", languages: ["typst"], where: "math", expand: "auto" },
});
const EXTRA = file("extra-pack", "pack", { "extra.one": { name: "One", prefix: "one", body: "1" } });
const PAPER = file("paper-structure", "pack", {
  $pack: { name: "Paper structure" },
  "paper.figure": { name: "Figure", prefix: "fig", body: { latex: "\\begin{figure}$1\\end{figure}", typst: "#figure($1)" } },
});
const SLASH = file("builtin-latex-slash", "builtin", {
  $pack: { name: "LaTeX slash menu" },
  "latex.slash.table": { name: "Table", prefix: "/table", body: "\\begin{tabular}{$1}\\end{tabular}", languages: ["latex"], expand: "list", where: "text" },
  "latex.slash.section": { name: "Section", prefix: "/section", body: "\\section{$1}", languages: ["latex"], expand: "list", where: "text" },
});

function ready({
  files = [SLASH, FAST, PAPER, MINE],
  state = {},
  problems = [],
}: {
  files?: ParsedSnippetFile[];
  state?: Partial<SnippetState>;
  problems?: SnippetProblem[];
} = {}) {
  const full: SnippetState = { disabledCollections: [], knownCollections: [], overrides: [], disabledRegex: [], ...state };
  const library = buildLibrary({
    files: [...files, { collection: "my-snippets", records: [], problems }],
    disabledCollections: new Set(full.disabledCollections),
    overrides: full.overrides,
    disabledRegex: new Set(full.disabledRegex),
  });
  useSnippetStore.setState({
    status: "ready",
    files,
    state: full,
    library,
    disk: [{ name: "my-snippets.json", modifiedMs: 1, text: "{}", parsed: MINE, good: MINE }],
    packs: { files: [FAST, TYPST, PAPER, EXTRA], defaultOff: ["fast-math-latex"] },
    ...actions,
  });
}

function rows(): string[] {
  return screen.queryAllByTestId("snippet-row").map((row) => within(row).getAllByRole("cell")[0].textContent ?? "");
}

function navItem(name: RegExp) {
  return within(screen.getByRole("navigation", { name: copy.library.collections })).getByRole("button", { name });
}

beforeEach(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  vi.clearAllMocks();
  useSettingsStore.getState().resetSnippetsPreferences();
  ready();
});

afterEach(() => {
  useSnippetStore.setState(initial, true);
});

describe("Settings › Snippets", () => {
  it("binds the four switches to the settings store and offers a reset once one changes", async () => {
    render(<SnippetsSection />);
    const auto = screen.getByRole("switch", { name: copy.switches.auto.label });
    expect(auto).toHaveAttribute("aria-checked", "true");
    await userEvent.click(auto);
    expect(useSettingsStore.getState().snippetsAuto).toBe(false);
    await userEvent.click(screen.getByRole("switch", { name: copy.switches.list.label }));
    await userEvent.click(screen.getByRole("switch", { name: copy.switches.tab.label }));
    await userEvent.click(screen.getByRole("switch", { name: copy.switches.hint.label }));
    expect(useSettingsStore.getState()).toMatchObject({ snippetsInList: false, snippetsTab: false, snippetsHint: false });
  });

  it("lists every snippet with its trigger, languages, place and expand mode", () => {
    render(<SnippetsSection />);
    expect(rows()).toEqual(["/table", "/section", "//", "fig", "rtab", "todo"]);
    const fraction = screen.getAllByTestId("snippet-row")[2];
    expect(within(fraction).getByText("Fraction")).toBeInTheDocument();
    expect(within(fraction).getByText(enShell.snippets.places.math)).toBeInTheDocument();
    expect(within(fraction).getByText(enShell.snippets.expands.auto)).toBeInTheDocument();
    const figure = screen.getAllByTestId("snippet-row")[3];
    expect(within(figure).getByText("LaTeX")).toBeInTheDocument();
    expect(within(figure).getByText("Typst")).toBeInTheDocument();
    expect(within(screen.getAllByTestId("snippet-row")[5]).getByText(copy.library.wraps)).toBeInTheDocument();
    expect(screen.getByText("6 of 6")).toBeInTheDocument();
  });

  it("searches names, triggers and body text", async () => {
    render(<SnippetsSection />);
    const search = screen.getByRole("searchbox", { name: copy.library.search });
    await userEvent.type(search, "fraction");
    expect(rows()).toEqual(["//"]);
    await userEvent.clear(search);
    await userEvent.type(search, "tabular");
    expect(rows()).toEqual(["/table"]);
    await userEvent.clear(search);
    await userEvent.type(search, "nothing like this");
    expect(rows()).toEqual([]);
    expect(screen.getByText(copy.library.noMatches)).toBeInTheDocument();
  });

  it("filters by language and by how a snippet expands", async () => {
    render(<SnippetsSection />);
    await userEvent.click(screen.getByRole("button", { name: copy.library.language }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "Typst" }));
    expect(rows()).toEqual(["fig"]);
    await userEvent.click(screen.getByRole("button", { name: copy.library.language }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: copy.library.allLanguages }));
    await userEvent.click(screen.getByRole("button", { name: copy.library.expands }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: enShell.snippets.expands.list }));
    expect(rows()).toEqual(["/table", "/section", "todo"]);
  });

  it("shows one collection at a time and switches whole collections", async () => {
    render(<SnippetsSection />);
    expect(navItem(/All snippets/u)).toHaveAttribute("aria-current", "page");
    expect(navItem(/My snippets/u)).toHaveTextContent("2");
    await userEvent.click(navItem(/Paper structure/u));
    expect(rows()).toEqual(["fig"]);
    await userEvent.click(navItem(/All snippets/u));
    expect(rows()).toHaveLength(6);
    await userEvent.click(screen.getByRole("switch", { name: "Use Paper structure" }));
    expect(actions.setCollectionEnabled).toHaveBeenCalledWith("paper-structure", false);
  });

  it("dims the rows of a collection that is turned off", () => {
    ready({ state: { disabledCollections: ["paper-structure"] } });
    render(<SnippetsSection />);
    const [, , fraction, figure] = screen.getAllByTestId("snippet-row");
    expect(figure).toHaveClass("[&>td]:opacity-60");
    expect(fraction).not.toHaveClass("[&>td]:opacity-60");
  });

  it("renders only the rows in view of a long list", () => {
    const entries = Object.fromEntries(
      Array.from({ length: 200 }, (_, index) => [`many.${index}`, { name: `Snippet ${index}`, prefix: `s${index}`, body: "x" }]),
    );
    ready({ files: [file("many", "pack", entries)] });
    render(<SnippetsSection />);
    expect(rows().length).toBeLessThan(40);
    expect(rows()[0]).toBe("s0");
    expect(screen.getByRole("table")).toHaveAttribute("aria-rowcount", "201");
    expect(screen.getByText("200 of 200")).toBeInTheDocument();
  });

  it("turns on expansion as you type when Fast math is turned on from the collections", async () => {
    ready({ files: [FAST, MINE], state: { disabledCollections: ["fast-math-latex"] } });
    useSettingsStore.getState().setSnippetsAuto(false);
    render(<SnippetsSection />);
    await userEvent.click(screen.getByRole("switch", { name: "Use Fast math · LaTeX" }));
    expect(actions.setCollectionEnabled).toHaveBeenCalledWith("fast-math-latex", true);
    expect(useSettingsStore.getState().snippetsAuto).toBe(true);
  });

  it("marks changed and turned-off built-ins and restores them", async () => {
    const overrides: SnippetOverride[] = [
      { id: "latex.slash.table", collection: "builtin-latex-slash", patch: { trigger: "/tab" } },
      { id: "latex.slash.section", collection: "builtin-latex-slash", disabled: true },
    ];
    ready({ state: { overrides } });
    render(<SnippetsSection />);
    const [table, section] = screen.getAllByTestId("snippet-row");
    expect(within(table).getByText(copy.library.modified)).toBeInTheDocument();
    expect(within(section).getByText(copy.library.turnedOff)).toBeInTheDocument();
    await userEvent.click(within(table).getByRole("button", { name: "Restore Table" }));
    expect(actions.setOverride).toHaveBeenCalledWith({ id: "latex.slash.table", collection: "builtin-latex-slash", clear: true });
  });

  it("names the file and line of each problem and hides them while every switch is off", async () => {
    ready({
      problems: [
        { collection: "my-snippets", line: 41, code: "ordinary-words", message: '"in" could expand while you write ordinary words', severity: "warning" },
        { collection: "_state", line: 2, code: "bad-value", message: "overrides is not a list", severity: "error" },
        { collection: "fast-math-latex", line: 9, code: "bad-regex", message: "bad pattern", severity: "error" },
      ],
      state: { disabledRegex: ["fm.frac", "gone.id"] },
    });
    render(<SnippetsSection />);
    const problems = screen.getByTestId("snippet-problems");
    expect(problems).toHaveTextContent('5 problems in my-snippets.json, line 41: "in" could expand while you write ordinary words');
    await userEvent.click(within(problems).getByRole("button", { name: copy.problems.show }));
    expect(problems).toHaveTextContent("in _state.json, line 2: overrides is not a list");
    expect(problems).toHaveTextContent("in Fast math · LaTeX, line 9: bad pattern");
    expect(problems).toHaveTextContent("The trigger of Fraction took too long to check, so the snippet was turned off.");
    expect(problems).toHaveTextContent("The trigger of gone.id took too long to check, so the snippet was turned off.");
    await userEvent.click(within(problems).getByRole("button", { name: copy.problems.hide }));
    expect(problems).not.toHaveTextContent("bad pattern");
    act(() => {
      const settings = useSettingsStore.getState();
      settings.setSnippetsInList(false);
      settings.setSnippetsTab(false);
      settings.setSnippetsAuto(false);
      settings.setSnippetsHint(false);
    });
    expect(screen.queryByTestId("snippet-problems")).toBeNull();
  });

  it("shows a single problem without a Show button", () => {
    ready({ problems: [{ collection: "my-snippets", line: 3, code: "json", message: "Not valid JSON.", severity: "error" }] });
    render(<SnippetsSection />);
    const problems = screen.getByTestId("snippet-problems");
    expect(problems).toHaveTextContent("1 problem in my-snippets.json, line 3: Not valid JSON.");
    expect(within(problems).queryByRole("button")).toBeNull();
  });

  it("reports a change that could not be saved", async () => {
    actions.setCollectionEnabled.mockRejectedValueOnce(new Error("Disk is full"));
    render(<SnippetsSection />);
    await userEvent.click(screen.getByRole("switch", { name: "Use My snippets" }));
    expect(await screen.findByText("Disk is full")).toBeInTheDocument();
  });

  it("reports snippets that could not be loaded", async () => {
    useSnippetStore.setState({ status: "loading", load: vi.fn(async () => Promise.reject(new Error("No snippets folder"))) });
    render(<SnippetsSection />);
    expect(await screen.findByText("No snippets folder")).toBeInTheDocument();
  });

  it("opens the editor for a snippet, for a new one in the open file's language, and goes back", async () => {
    render(<SnippetsSection />);
    await userEvent.click(screen.getByRole("button", { name: "rtab" }));
    expect(screen.getByTestId("snippet-editor")).toBeInTheDocument();
    expect(screen.getByLabelText(copy.editor.name)).toHaveValue("Results table");
    await userEvent.click(screen.getByRole("button", { name: enShell.settings.nav.snippets }));
    await userEvent.click(navItem(/My snippets/u));
    await userEvent.click(screen.getByRole("button", { name: copy.library.newSnippet }));
    expect(screen.getByLabelText(copy.editor.name)).toHaveValue("");
    expect(screen.getByRole("button", { name: "Any" })).toHaveAttribute("aria-pressed", "true");
  });

  it("opens the snippet an editor asked for once the library has it", async () => {
    ready({ files: [SLASH] });
    render(<SnippetsSection />);
    act(() => openSnippetSettings("paper.figure"));
    expect(screen.queryByTestId("snippet-editor")).toBeNull();
    act(() => ready());
    expect(await screen.findByTestId("snippet-editor")).toBeInTheDocument();
    expect(screen.getByLabelText(copy.editor.trigger)).toHaveValue("fig");
  });

  it("adds packs and imports a VS Code snippet file", async () => {
    render(<SnippetsSection />);
    await userEvent.click(screen.getByRole("button", { name: copy.library.add }));
    const dialog = await screen.findByRole("dialog", { name: copy.addDialog.title });
    const fast = within(dialog).getByTestId("snippet-pack-fast-math-latex");
    expect(fast).toHaveTextContent("From https://github.com/gillescastel/latex-snippets · MIT licence");
    expect(fast).toHaveTextContent(copy.addDialog.packs.fastMathLatex);
    useSettingsStore.getState().setSnippetsAuto(false);
    await userEvent.click(within(fast).getByRole("switch", { name: "Use Fast math · LaTeX" }));
    expect(actions.setCollectionEnabled).toHaveBeenCalledWith("fast-math-latex", false);
    await userEvent.click(within(within(dialog).getByTestId("snippet-pack-paper-structure")).getByRole("switch"));
    expect(actions.setCollectionEnabled).toHaveBeenCalledWith("paper-structure", false);
    const typst = within(dialog).getByTestId("snippet-pack-fast-math-typst");
    expect(typst).toHaveTextContent("MIT licence");
    expect(typst).not.toHaveTextContent("From");
    await userEvent.click(within(typst).getByRole("switch"));
    expect(actions.setCollectionEnabled).toHaveBeenCalledWith("fast-math-typst", false);
    expect(within(dialog).getByTestId("snippet-pack-extra-pack").querySelectorAll("p")).toHaveLength(0);

    await userEvent.click(within(dialog).getByRole("tab", { name: copy.addDialog.importTab }));
    const input = within(dialog).getByLabelText(copy.addDialog.fileLabel);
    const snippets = '{\n  // VS Code writes comments\n  "Proof": { "prefix": "prf", "body": ["\\\\begin{proof}", "$0", "\\\\end{proof}"] },\n  "Broken": { "body": 3 },\n}';
    fireEvent.change(input, { target: { files: [] } });
    expect(actions.importVsCodeFile).not.toHaveBeenCalled();
    await userEvent.upload(input, new File([snippets], "latex.json", { type: "application/json" }));
    const outcome = await within(dialog).findByTestId("snippet-import-outcome");
    expect(outcome).toHaveTextContent("Imported 1 snippet into latex.");
    expect(outcome).toHaveTextContent("1 entry was left out:");
    expect(actions.importVsCodeFile).toHaveBeenCalledWith("latex.json", snippets);

    await userEvent.upload(input, new File(["{}"], "empty.json", { type: "application/json" }));
    expect(await within(dialog).findByText("No snippets were found in empty.json.")).toBeInTheDocument();
    actions.importVsCodeFile.mockRejectedValueOnce(new Error("Could not write the file"));
    await userEvent.upload(input, new File(["{}"], "fails.json", { type: "application/json" }));
    expect(await within(dialog).findByText("Could not write the file")).toBeInTheDocument();
  });

  it("turns on expansion as you type when a Fast math pack is turned on", async () => {
    ready({ state: { disabledCollections: ["fast-math-latex"] } });
    useSettingsStore.getState().setSnippetsAuto(false);
    render(<SnippetsSection />);
    await userEvent.click(screen.getByRole("button", { name: copy.library.add }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("switch", { name: "Use Fast math · LaTeX" }));
    expect(actions.setCollectionEnabled).toHaveBeenCalledWith("fast-math-latex", true);
    expect(useSettingsStore.getState().snippetsAuto).toBe(true);
    actions.setCollectionEnabled.mockRejectedValueOnce(new Error("Read-only folder"));
    await userEvent.click(within(within(dialog).getByTestId("snippet-pack-paper-structure")).getByRole("switch"));
    await waitFor(() => expect(within(dialog).getByText("Read-only folder")).toBeInTheDocument());
  });

  it("opens Add snippets afresh after it was closed", async () => {
    actions.setCollectionEnabled.mockRejectedValueOnce(new Error("Read-only folder"));
    render(<SnippetsSection />);
    await userEvent.click(screen.getByRole("button", { name: copy.library.add }));
    let dialog = await screen.findByRole("dialog", { name: copy.addDialog.title });
    await userEvent.click(within(within(dialog).getByTestId("snippet-pack-paper-structure")).getByRole("switch"));
    expect(await within(dialog).findByText("Read-only folder")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("tab", { name: copy.addDialog.importTab }));
    await userEvent.upload(within(dialog).getByLabelText(copy.addDialog.fileLabel), new File(["{}"], "empty.json", { type: "application/json" }));
    expect(await within(dialog).findByText("No snippets were found in empty.json.")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await userEvent.click(screen.getByRole("button", { name: copy.library.add }));
    dialog = await screen.findByRole("dialog", { name: copy.addDialog.title });
    expect(within(dialog).queryByText("Read-only folder")).toBeNull();
    await userEvent.click(within(dialog).getByRole("tab", { name: copy.addDialog.importTab }));
    expect(within(dialog).queryByText("No snippets were found in empty.json.")).toBeNull();
  });
});
