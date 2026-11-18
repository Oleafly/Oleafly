// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

function open(content: string) {
  act(() => useFilesStore.setState({ files: { "refs.bib": { content, dirty: false } } } as never));
}

afterEach(() => {
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

  it("names one author, two joined, and three or more as the first et al.", () => {
    expect(authorLine("Knuth, Donald E.")).toBe("Knuth");
    expect(authorLine("Ada Lovelace and Charles Babbage")).toBe("Lovelace and Babbage");
    expect(authorLine(undefined)).toBe("");
  });
});

describe("BibReferenceList", () => {
  it("lists the file's references, follows edits, filters by search and jumps to an entry", () => {
    open(BIB);
    const onReveal = vi.fn();
    render(<BibReferenceList path="refs.bib" onReveal={onReveal} />);
    const list = screen.getByTestId("bib-reference-list");
    expect(within(list).getByText(copy.count_other.replace("{{count}}", "3"))).toBeInTheDocument();
    expect(within(list).getByText("Attention is All you Need")).toBeInTheDocument();
    expect(within(list).getByText("Vaswani et al. · 2017 · NeurIPS")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: copy.search }), { target: { value: "bahdanau" } });
    expect(within(list).queryByText("Attention is All you Need")).toBeNull();
    fireEvent.click(within(list).getByText("Neural Machine Translation by Jointly Learning to Align and Translate"));
    expect(onReveal).toHaveBeenCalledWith(BIB.indexOf("@article"));

    fireEvent.change(screen.getByRole("searchbox", { name: copy.search }), { target: { value: "zzz" } });
    expect(within(list).getByText(copy.noMatch)).toBeInTheDocument();
  });

  it("says so when the file has no references", () => {
    open("% nothing here\n");
    render(<BibReferenceList path="refs.bib" onReveal={vi.fn()} />);
    expect(screen.getByText(copy.empty)).toBeInTheDocument();
    expect(screen.getByText(copy.count_other.replace("{{count}}", "0"))).toBeInTheDocument();
  });
});
