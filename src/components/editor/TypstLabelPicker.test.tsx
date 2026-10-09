// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };
import type { Sym } from "@/lib/index/types";

const commands = vi.hoisted(() => ({
  addTypstLabel: vi.fn(async () => {}),
  insertTypstReferenceTo: vi.fn(async () => {}),
}));

vi.mock("@/components/editor/typst-commands", () => commands);

import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import { collectTypstLabels, TypstLabelPicker } from "./TypstLabelPicker";

function label(name: string, file: string, line: number): Sym {
  return { kind: "label", name, file, line, from: 0, to: 0, nameFrom: 0, nameTo: 0 };
}

const DEFS: Sym[] = [
  label("fig:old", "main.typ", 9),
  label("tab:data", "chapters/b.typ", 4),
  label("eq:energy", "chapters/a.typ", 2),
  label("sec:tex", "appendix.tex", 1),
  { ...label("Intro", "chapters/a.typ", 1), kind: "section" },
];

beforeEach(() => {
  vi.clearAllMocks();
  useFilesStore.setState({
    activePath: "main.typ",
    files: { "main.typ": { content: "= Intro <sec:intro>\n$ x $ <eq:x>\n" } },
  } as never);
  useIndexStore.setState({ index: { defs: DEFS } } as never);
});

describe("collectTypstLabels", () => {
  it("lists the open file from its live text, then other Typst files", () => {
    const labels = collectTypstLabels(DEFS, "main.typ", "= Intro <sec:intro>\n$ x $ <eq:x>\n", "");
    expect(labels).toEqual([
      { name: "sec:intro", file: "main.typ", line: 1 },
      { name: "eq:x", file: "main.typ", line: 2 },
      { name: "eq:energy", file: "chapters/a.typ", line: 2 },
      { name: "tab:data", file: "chapters/b.typ", line: 4 },
    ]);
  });

  it("filters by name", () => {
    expect(collectTypstLabels(DEFS, "main.typ", "", "TAB").map((entry) => entry.name)).toEqual(["tab:data"]);
  });
});

describe("TypstLabelPicker", () => {
  it("references a picked label and can add a label", () => {
    render(<TypstLabelPicker variant="bar" />);
    fireEvent.click(screen.getByLabelText(en.toolbar.insertCrossReference));
    expect(screen.queryByText("sec:tex")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("eq:energy"));
    expect(commands.insertTypstReferenceTo).toHaveBeenCalledWith("eq:energy");

    fireEvent.click(screen.getByLabelText(en.toolbar.insertCrossReference));
    fireEvent.click(screen.getByText(en.labels.addHere));
    expect(commands.addTypstLabel).toHaveBeenCalledOnce();
  });

  it("shows a new search's results from the top of the list", () => {
    render(<TypstLabelPicker variant="bar" />);
    fireEvent.click(screen.getByLabelText(en.toolbar.insertCrossReference));
    const list = screen.getByText("eq:energy").closest(".overflow-y-auto") as HTMLElement;
    list.scrollTop = 240;

    fireEvent.change(screen.getByLabelText(en.labels.filterLabel), { target: { value: "tab" } });

    expect(screen.getByText("tab:data")).toBeInTheDocument();
    expect(list.scrollTop).toBe(0);
  });

  it("explains an empty list and a search without matches", () => {
    useIndexStore.setState({ index: null } as never);
    useFilesStore.setState({ files: { "main.typ": { content: "" } } } as never);
    render(<TypstLabelPicker variant="menu" />);
    fireEvent.click(screen.getByText(en.toolbar.insertCrossReference));
    expect(screen.getByText(en.labels.empty)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(en.labels.filterLabel), { target: { value: "zzz" } });
    expect(screen.getByText(en.labels.noMatches)).toBeInTheDocument();
  });
});
