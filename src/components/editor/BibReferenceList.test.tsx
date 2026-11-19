// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ROW_WINDOW_ITEM } from "@/hooks/use-row-window";
import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import { useFilesStore } from "@/store/files";
import { authorLine, BibReferenceList, bibRows } from "./BibReferenceList";

const copy = enEditor.bibList;

const BIB = String.raw`@string{neurips = "Advances in Neural Information Processing Systems"}

@inproceedings{vaswani2017attention,
  title = {Attention is All you {Need}},
  author = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki},
  booktitle = {NeurIPS},
  year = {2017}
}

@article{bahdanau2014,
  title = {Neural Machine Translation by Jointly Learning to Align and Translate},
  author = {Dzmitry Bahdanau and Kyunghyun Cho},
  journal = {arXiv preprint},
  date = {2014-09-01}
}

@misc{noauthor,
  title = {Caf{\'e} notes}
}
`;

const ROW_HEIGHT = 56;
const VIEWPORT = 200;
let opened = 0;

function open(content: string): string {
  opened += 1;
  const path = `refs-${opened}.bib`;
  act(() => useFilesStore.setState({ projectId: "p1", files: { [path]: { content, dirty: false } } } as never));
  return path;
}

function countText(key: "count_one" | "count_other" | "matchCount_one" | "matchCount_other", values: Record<string, number>) {
  return Object.entries(values).reduce((text, [name, value]) => text.replace(`{{${name}}}`, String(value)), copy[key]);
}

function rect(top: number, height: number): DOMRect {
  return { top, bottom: top + height, left: 0, right: 400, width: 400, height, x: 0, y: top, toJSON: () => ({}) };
}

function laidOut() {
  const geometry = { scrollTop: 0 };
  const isScroller = (element: Element) => element.classList.contains("overflow-y-auto");
  vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function (this: Element) {
    return isScroller(this) ? VIEWPORT : 0;
  });
  vi.spyOn(Element.prototype, "scrollTop", "get").mockImplementation(function (this: Element) {
    return isScroller(this) ? geometry.scrollTop : 0;
  });
  vi.spyOn(Element.prototype, "scrollTop", "set").mockImplementation(function (this: Element, value: number) {
    if (isScroller(this)) geometry.scrollTop = value;
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.hasAttribute(ROW_WINDOW_ITEM)) return rect(0, ROW_HEIGHT);
    if (this.parentElement && isScroller(this.parentElement)) return rect(-geometry.scrollTop, 0);
    return rect(0, VIEWPORT);
  });
  return geometry;
}

afterEach(() => {
  vi.restoreAllMocks();
  useFilesStore.setState({ files: {} } as never);
});

describe("bibRows", () => {
  it("reads each reference with its source position and skips string definitions", () => {
    const rows = bibRows(BIB);
    expect(rows.map((row) => row.key)).toEqual(["vaswani2017attention", "bahdanau2014", "noauthor"]);
    expect(rows[0]).toMatchObject({
      type: "inproceedings",
      title: "Attention is All you Need",
      authors: "Vaswani et al.",
      year: "2017",
      venue: "NeurIPS",
      from: BIB.indexOf("@inproceedings"),
    });
    expect(rows[1]).toMatchObject({ authors: "Bahdanau and Cho", year: "2014", venue: "arXiv preprint" });
    expect(rows[2]).toMatchObject({ title: "Café notes", authors: "", year: "", venue: "" });
  });

  it("shows titles, authors and venues as readable text", () => {
    const bib = String.raw`@book{knuth1984,
  title = {The {\TeX}book},
  author = {Knuth, Donald E.},
  publisher = {Addison{-}Wesley \& Sons}
}
@book{lamport1994,
  title = {{\LaTeX}: A Document Preparation System},
  author = {Leslie Lamport},
  edition = {2nd}
}
@article{goedel,
  title = {{\"U}ber formal unentscheidbare S{\"a}tze, pages 173--198},
  author = {G{\"o}del, Kurt},
  journal = {Monatshefte f{\"u}r Mathematik~und Physik}
}`;
    const rows = bibRows(bib);
    expect(rows.map((row) => row.title)).toEqual([
      "The TeXbook",
      "LaTeX: A Document Preparation System",
      "Über formal unentscheidbare Sätze, pages 173–198",
    ]);
    expect(rows.map((row) => row.authors)).toEqual(["Knuth", "Lamport", "Gödel"]);
    expect(rows[0].venue).toBe("Addison-Wesley & Sons");
    expect(rows[2].venue).toBe("Monatshefte für Mathematik und Physik");
  });

  it("gives a repeated key the position of each of its entries", () => {
    const bib = "@misc{same, title = {One}}\n@misc{same, title = {Two}}\n";
    expect(bibRows(bib).map((row) => row.from)).toEqual([0, bib.lastIndexOf("@misc")]);
  });
});

describe("authorLine", () => {
  it("names one author, two joined, and three or more as the first et al.", () => {
    expect(authorLine("Knuth, Donald E.")).toBe("Knuth");
    expect(authorLine("Ada Lovelace and Charles Babbage")).toBe("Lovelace and Babbage");
    expect(authorLine(undefined)).toBe("");
    expect(authorLine("   ")).toBe("");
  });

  it("keeps a braced name whole and reads a trailing others as et al.", () => {
    expect(authorLine("{Barnes and Noble} and {IEEE Computer Society}")).toBe("Barnes and Noble and IEEE Computer Society");
    expect(authorLine("{World Health Organization}")).toBe("World Health Organization");
    expect(authorLine("Smith, John and others")).toBe("Smith et al.");
    expect(authorLine("von Neumann, John and Oskar Morgenstern")).toBe("von Neumann and Morgenstern");
    expect(authorLine(String.raw`{\"O}zt{\"u}rk, Ay{\c{s}}e AND Jane Doe`)).toBe("Öztürk and Doe");
  });
});

describe("BibReferenceList", () => {
  it("lists the file's references, follows edits, filters by search and jumps to an entry", () => {
    const path = open(BIB);
    const onReveal = vi.fn();
    render(<BibReferenceList path={path} onReveal={onReveal} />);
    const list = screen.getByTestId("bib-reference-list");
    expect(within(list).getByText(countText("count_other", { count: 3 }))).toBeInTheDocument();
    expect(within(list).getByText("Attention is All you Need")).toBeInTheDocument();
    expect(within(list).getByText("Vaswani et al. · 2017 · NeurIPS")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: copy.search }), { target: { value: "bahdanau" } });
    expect(within(list).queryByText("Attention is All you Need")).toBeNull();
    expect(within(list).getByText(countText("matchCount_other", { shown: 1, total: 3 }))).toBeInTheDocument();
    fireEvent.click(within(list).getByText("Neural Machine Translation by Jointly Learning to Align and Translate"));
    expect(onReveal).toHaveBeenCalledWith(BIB.indexOf("@article"));
  });

  it("counts against a single reference in the singular", () => {
    const path = open("@misc{only, title = {Only one}}\n");
    render(<BibReferenceList path={path} onReveal={vi.fn()} />);
    expect(screen.getByText(countText("count_one", { count: 1 }))).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: copy.search }), { target: { value: "zzz" } });
    expect(screen.getByText(countText("matchCount_one", { shown: 0, total: 1 }))).toBeInTheDocument();
  });

  it("offers to clear a search that matches nothing and puts the caret back in the field", () => {
    const path = open(BIB);
    render(<BibReferenceList path={path} onReveal={vi.fn()} />);
    const field = screen.getByRole("searchbox", { name: copy.search });
    fireEvent.change(field, { target: { value: "zzz" } });
    expect(screen.getByText(copy.noMatch)).toBeInTheDocument();
    expect(screen.getByText(countText("matchCount_other", { shown: 0, total: 3 }))).toBeInTheDocument();

    const clear = screen.getAllByRole("button", { name: copy.clearSearch });
    expect(clear).toHaveLength(2);
    fireEvent.click(clear[1]);
    expect(field).toHaveValue("");
    expect(field).toHaveFocus();
    expect(screen.queryByText(copy.noMatch)).toBeNull();
    expect(screen.getByText(countText("count_other", { count: 3 }))).toBeInTheDocument();
  });

  it("says so when the file has no references", () => {
    const path = open("% nothing here\n");
    render(<BibReferenceList path={path} onReveal={vi.fn()} />);
    expect(screen.getByText(copy.empty)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.clearSearch })).toBeNull();
    expect(screen.getByText(countText("count_other", { count: 0 }))).toBeInTheDocument();
  });

  it("keeps the search and marks the picked entry when the list opens again, scrolled into view", () => {
    const bib = Array.from({ length: 60 }, (_, index) => `@misc{k${index}, title = {Entry ${index}}}`).join("\n");
    const path = open(bib);
    const geometry = laidOut();
    const onReveal = vi.fn();
    const first = render(<BibReferenceList path={path} onReveal={onReveal} />);
    fireEvent.change(screen.getByRole("searchbox", { name: copy.search }), { target: { value: "Entry 4" } });
    fireEvent.click(screen.getByText("Entry 45"));
    expect(onReveal).toHaveBeenCalledWith(bib.indexOf("@misc{k45"));
    expect(screen.getByRole("searchbox", { name: copy.search })).toHaveValue("Entry 4");
    const picked = screen.getByText("Entry 45").closest("button");
    expect(picked).toHaveAttribute("aria-current", "true");
    expect(picked).toHaveClass("bg-primary/10");
    expect(screen.getByText("Entry 44").closest("button")).not.toHaveAttribute("aria-current");

    first.unmount();
    geometry.scrollTop = 0;
    render(<BibReferenceList path={path} onReveal={onReveal} />);
    expect(screen.getByRole("searchbox", { name: copy.search })).toHaveValue("Entry 4");
    expect(screen.getByText(countText("matchCount_other", { shown: 11, total: 60 }))).toBeInTheDocument();
    expect(screen.getByText("Entry 45").closest("button")).toHaveAttribute("aria-current", "true");
    expect(geometry.scrollTop).toBe(7 * ROW_HEIGHT - VIEWPORT);

    fireEvent.click(screen.getAllByRole("button", { name: copy.clearSearch })[0]);
    expect(geometry.scrollTop).toBe(46 * ROW_HEIGHT - VIEWPORT);
    expect(screen.getByText("Entry 45").closest("button")).toHaveAttribute("aria-current", "true");
  });

  it("keeps each file's search to itself", () => {
    const first = open(BIB);
    const view = render(<BibReferenceList path={first} onReveal={vi.fn()} />);
    fireEvent.change(screen.getByRole("searchbox", { name: copy.search }), { target: { value: "bahdanau" } });
    const second = open(BIB);
    view.rerender(<BibReferenceList path={second} onReveal={vi.fn()} />);
    expect(screen.getByRole("searchbox", { name: copy.search })).toHaveValue("");
    view.rerender(<BibReferenceList path={first} onReveal={vi.fn()} />);
    expect(screen.getByRole("searchbox", { name: copy.search })).toHaveValue("bahdanau");
  });
});
