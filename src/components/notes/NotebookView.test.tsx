// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it } from "vitest";
import { loadNamespace } from "@/i18n";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { CELL_LIMIT, htmlOutputDocument, mountNotebook, NotebookView, OUTPUT_LINES } from "./NotebookView";

const copy = enNotes.notebook;
const LAZY_MS = 10_000;

function notebook(cells: unknown[], language = "python"): string {
  return JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: { language_info: { name: language } }, cells });
}

function code(source: string, outputs: unknown[] = [], count: number | null = 1) {
  return { cell_type: "code", source, execution_count: count, outputs };
}

function markdown(source: string) {
  return { cell_type: "markdown", source };
}

function display(data: Record<string, unknown>) {
  return { output_type: "display_data", data };
}

beforeAll(async () => {
  await loadNamespace("notes");
  await loadNamespace("common");
});

describe("NotebookView", () => {
  it("renders Markdown cells with the app's Markdown and math", async () => {
    const { container } = render(<NotebookView text={notebook([markdown("# Loss curve\n\nThe loss is $x^2$.")])} />);
    expect(await screen.findByRole("heading", { name: "Loss curve" }, { timeout: LAZY_MS })).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector(".katex")).not.toBeNull(), { timeout: LAZY_MS });
  });

  it("shows code in the kernel language with its execution count", () => {
    const { container } = render(
      <NotebookView text={notebook([code("print(1)", [], 3), code("pass", [], null)], "julia")} />,
    );
    expect(screen.getByText("[3]")).toBeInTheDocument();
    expect(screen.getByText("[ ]")).toBeInTheDocument();
    const block = container.querySelector('[data-notebook-cell="code"] code');
    expect(block).toHaveAttribute("data-language", "julia");
    expect(block).toHaveTextContent("print(1)");
  });

  it("leaves code plain when the notebook names no language", () => {
    const text = JSON.stringify({ nbformat: 4, metadata: {}, cells: [code("x = 1")] });
    const { container } = render(<NotebookView text={text} />);
    expect(container.querySelector('[data-notebook-cell="code"] code')).not.toHaveAttribute("data-language");
  });

  it("shows raw cells as plain text", () => {
    const { container } = render(<NotebookView text={notebook([{ cell_type: "raw", source: "\\section{Raw}" }])} />);
    expect(container.querySelector('[data-notebook-cell="raw"]')).toHaveTextContent("\\section{Raw}");
  });

  it("shows PNG and SVG outputs as images and never puts the SVG markup in the page", () => {
    const { container } = render(
      <NotebookView
        text={notebook([
          markdown("Intro"),
          code("plot()", [display({ "image/png": "iVBORw0K", "text/plain": "<Figure>" })], 2),
          code("svg()", [display({ "image/svg+xml": '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>' })], 3),
        ])}
      />,
    );
    expect(screen.getByRole("img", { name: "Output of cell 2" })).toHaveAttribute("src", "data:image/png;base64,iVBORw0K");
    expect(screen.getByRole("img", { name: "Output of cell 3" }).getAttribute("src")).toMatch(/^data:image\/svg\+xml;charset=utf-8,/u);
    expect(container.querySelector("circle")).toBeNull();
    expect(screen.queryByText("<Figure>")).toBeNull();
  });

  it("shows HTML output in a frame that runs no scripts and shares no origin", () => {
    render(<NotebookView text={notebook([code("df", [display({ "text/html": "<table><tr><td>64.1</td></tr></table>" })], 4)])} />);
    const frame = screen.getByTitle("HTML output of cell 1");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
    const document = frame.getAttribute("srcdoc") ?? "";
    expect(document).toContain("<td>64.1</td>");
    expect(document).toContain("default-src 'none'");
  });

  it("drops scripts, embedded frames and event handlers from HTML output before it reaches the frame", () => {
    render(
      <NotebookView
        text={notebook([
          code("df", [
            display({
              "text/html":
                '<meta http-equiv="refresh" content="0"><style>td{color:red}</style><table><tr><td onclick="steal()">1</td></tr></table><img src="x" onerror="steal()"><script>steal()</script><iframe src="https://example.org"></iframe>',
            }),
          ]),
        ])}
      />,
    );
    const document = screen.getByTitle("HTML output of cell 1").getAttribute("srcdoc") ?? "";
    expect(document).toContain("<style>td{color:red}</style>");
    expect(document).toContain("<td>1</td>");
    expect(document).toContain('<img src="x">');
    expect(document).not.toContain("steal");
    expect(document).not.toContain("https://example.org");
    expect(document).not.toContain("refresh");
  });

  it("puts the content policy before the output in the frame document", () => {
    const document = htmlOutputDocument("<script>alert(1)</script>");
    expect(document.indexOf("Content-Security-Policy")).toBeLessThan(document.indexOf("<script>"));
    expect(document).toContain("img-src data:");
  });

  it("shows Markdown and plain text results", async () => {
    render(
      <NotebookView
        text={notebook([
          code("md()", [{ output_type: "execute_result", data: { "text/markdown": "**Accuracy** is up" } }]),
          code("value", [{ output_type: "execute_result", data: { "text/plain": "64.1" } }], 2),
        ])}
      />,
    );
    expect(await screen.findByText("Accuracy", { selector: "strong" }, { timeout: LAZY_MS })).toBeInTheDocument();
    expect(screen.getByText("64.1")).toBeInTheDocument();
  });

  it("tints standard error and shows an error with its traceback", () => {
    const { container } = render(
      <NotebookView
        text={notebook([
          code("warn()", [{ output_type: "stream", name: "stderr", text: "careful" }]),
          code(
            "1/0",
            [{ output_type: "error", ename: "ZeroDivisionError", evalue: "division by zero", traceback: ["Traceback", "line 1"] }],
            2,
          ),
          code("raise", [{ output_type: "error", ename: "KeyboardInterrupt", evalue: "", traceback: [] }], 3),
        ])}
      />,
    );
    expect(screen.getByText("careful").closest("pre")).toHaveClass("bg-destructive/5");
    expect(screen.getByText("ZeroDivisionError: division by zero")).toBeInTheDocument();
    expect(screen.getByText(/Traceback\s+line 1/u)).toBeInTheDocument();
    const errors = container.querySelectorAll("[data-notebook-error]");
    expect(errors[1]).toHaveTextContent("KeyboardInterrupt");
    expect(errors[1].querySelector("pre")).toBeNull();
  });

  it("folds a long output behind Show all and folds it again", async () => {
    const user = userEvent.setup();
    const lines = Array.from({ length: OUTPUT_LINES + 10 }, (_, index) => `line ${String(index + 1)}`).join("\n");
    render(<NotebookView text={notebook([code("log()", [{ output_type: "stream", name: "stdout", text: lines }])])} />);
    const pre = () => document.querySelector("[data-notebook-text] pre");
    expect(pre()).toHaveTextContent(`line ${String(OUTPUT_LINES)}`);
    expect(pre()).not.toHaveTextContent(`line ${String(OUTPUT_LINES + 1)}`);
    const toggle = screen.getByRole("button", { name: copy.showAll });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(pre()).toHaveTextContent(`line ${String(OUTPUT_LINES + 10)}`);
    await user.click(screen.getByRole("button", { name: copy.showLess }));
    expect(pre()).not.toHaveTextContent(`line ${String(OUTPUT_LINES + 1)}`);
  });

  it("folds one very long line too", () => {
    const text = "x".repeat(7000);
    render(<NotebookView text={notebook([code("x", [{ output_type: "stream", text }])])} />);
    expect(document.querySelector("[data-notebook-text] pre")?.textContent).toHaveLength(6000);
    expect(screen.getByRole("button", { name: copy.showAll })).toBeInTheDocument();
  });

  it("leaves short output unfolded", () => {
    render(<NotebookView text={notebook([code("x", [{ output_type: "stream", text: "short" }])])} />);
    expect(screen.queryByRole("button", { name: copy.showAll })).toBeNull();
  });

  it("shows the first cells of a long notebook and the rest on request", async () => {
    const user = userEvent.setup();
    const count = CELL_LIMIT + 5;
    const { container } = render(
      <NotebookView text={notebook(Array.from({ length: count }, (_, index) => code(`cell_${String(index + 1)}`)))} />,
    );
    expect(container.querySelectorAll("[data-notebook-cell]")).toHaveLength(CELL_LIMIT);
    await user.click(screen.getByRole("button", { name: `Show all ${String(count)} cells` }));
    expect(container.querySelectorAll("[data-notebook-cell]")).toHaveLength(count);
    expect(screen.queryByRole("button", { name: /Show all \d+ cells/u })).toBeNull();
  });

  it("shows only the cells in the range", () => {
    const { container } = render(
      <NotebookView text={notebook([code("one"), code("two", [], 2), code("three", [], 3)])} cells={{ from: 2, to: 3 }} />,
    );
    expect([...container.querySelectorAll('[data-notebook-cell="code"] code')].map((node) => node.textContent)).toEqual([
      "two",
      "three",
    ]);
  });

  it("hides code but keeps outputs, and drops code cells with no output", () => {
    const { container } = render(
      <NotebookView
        text={notebook([markdown("Notes"), code("setup()"), code("print(2)", [{ output_type: "stream", text: "2" }], 2)])}
        hideCode
      />,
    );
    expect(container.querySelectorAll("[data-notebook-cell]")).toHaveLength(2);
    expect(screen.queryByText("print(2)")).toBeNull();
    expect(screen.getByText("2", { selector: "pre" })).toBeInTheDocument();
    expect(screen.getByText("[2]")).toBeInTheDocument();
  });

  it("says when hiding the code leaves nothing", () => {
    render(<NotebookView text={notebook([code("setup()")])} hideCode />);
    expect(screen.getByText(copy.nothingShown)).toBeInTheDocument();
  });

  it("says when the range is past the last cell", () => {
    render(<NotebookView text={notebook([code("a"), code("b")])} cells={{ from: 5, to: 9 }} />);
    expect(screen.getByText(copy.outOfRange_other.replace("{{count}}", "2"))).toBeInTheDocument();
  });

  it.each([
    ["{ not json", copy.invalid],
    [JSON.stringify({ nbformat: 3, worksheets: [] }), copy.unsupported],
    [notebook([]), copy.empty],
  ])("explains %j", (text, message) => {
    render(<NotebookView text={text} />);
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it("mounts into a plain element and unmounts after the current task", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const mounted = mountNotebook(host);
    act(() => mounted.render({ text: notebook([code("mounted()")]) }));
    expect(host).toHaveTextContent("mounted()");
    act(() => mounted.render({ text: notebook([code("again()")]), hideCode: false, cells: null }));
    expect(host).toHaveTextContent("again()");
    mounted.unmount();
    expect(host).toHaveTextContent("again()");
    await act(async () => {
      await Promise.resolve();
    });
    expect(host).toBeEmptyDOMElement();
    host.remove();
  });
});
