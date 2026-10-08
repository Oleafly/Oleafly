// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMissingInZotero: vi.fn(),
  ensureZoteroEntries: vi.fn(),
  staleZoteroEntries: vi.fn(),
  updateZoteroEntries: vi.fn(),
  refresh: vi.fn(async () => {}),
  logError: vi.fn(async () => {}),
}));

vi.mock("@/features/zotero-cite", () => ({
  findMissingInZotero: mocks.findMissingInZotero,
  ensureZoteroEntries: mocks.ensureZoteroEntries,
  staleZoteroEntries: mocks.staleZoteroEntries,
  updateZoteroEntries: mocks.updateZoteroEntries,
}));
vi.mock("@/features/zotero-actions", () => ({
  useZoteroStaleStore: { getState: () => ({ refresh: mocks.refresh }) },
}));
vi.mock("@/components/zotero/ZoteroHintBanner", () => ({ ZoteroHintBanner: () => null }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enReferences from "@/i18n/locales/en/references.json" with { type: "json" };
import { useZoteroDialogStore } from "@/store/zotero-dialogs";
import { ZoteroDialogs } from "./ZoteroDialogs";

const missing = enReferences.zotero.missing;
const update = enReferences.zotero.update;
const choose = enReferences.zotero.chooseBibliography;
const handEdits = enReferences.zotero.handEdits;

const hit = (title: string) =>
  ({ title, authors: ["Efron"], authorCount: 1, year: "1979" }) as never;
const pick = (key: string) => ({ key, hit: hit(`Paper ${key}`) });
const stale = (key: string, handEdited = false) =>
  ({ key, bib: "refs.bib", hit: hit(`Paper ${key}`), link: {}, handEdited }) as never;

function open(kind: "missing" | "update") {
  act(() => useZoteroDialogStore.getState().openBulk(kind));
}

beforeEach(() => {
  vi.clearAllMocks();
  useZoteroDialogStore.setState({ handList: null, handEdits: null, bibliographyChoice: null, bulk: null });
});

describe("adding missing citations from Zotero", () => {
  it("lists what Zotero has, what is duplicated and what is missing, then adds the found entries", async () => {
    mocks.findMissingInZotero.mockResolvedValue({
      found: [pick("efron1979")],
      duplicates: [{ key: "efron79", existing: "efron1979" }],
      missing: ["ghost2020"],
    });
    mocks.ensureZoteroEntries.mockResolvedValue({ added: ["efron1979"], reused: [], bibPath: "refs.bib" });
    render(<ZoteroDialogs />);
    open("missing");

    expect(screen.getByText(missing.loading)).toBeInTheDocument();
    expect(await screen.findByText("efron1979")).toBeInTheDocument();
    expect(screen.getByText("efron79 is the same paper as efron1979")).toBeInTheDocument();
    expect(screen.getByText("ghost2020")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("zotero-missing-confirm"));

    expect(await screen.findByText("1 entry is now in refs.bib.")).toBeInTheDocument();
    expect(mocks.ensureZoteroEntries).toHaveBeenCalledWith([pick("efron1979")], expect.any(Object));
    expect(mocks.refresh).toHaveBeenCalled();
    fireEvent.click(screen.getByText(enCommon.actions.close, { selector: "button" }));
    expect(useZoteroDialogStore.getState().bulk).toBeNull();
  });

  it("says when every cited key is already in the bibliography", async () => {
    mocks.findMissingInZotero.mockResolvedValue({ found: [], duplicates: [], missing: [] });
    render(<ZoteroDialogs />);
    open("missing");

    expect(await screen.findByText(missing.none)).toBeInTheDocument();
    expect(screen.queryByTestId("zotero-missing-confirm")).toBeNull();
  });

  it("shows why the check failed", async () => {
    mocks.findMissingInZotero.mockRejectedValue(new Error("Zotero closed"));
    render(<ZoteroDialogs />);
    open("missing");

    expect(await screen.findByRole("alert")).toHaveTextContent("Zotero closed");
    expect(mocks.logError).toHaveBeenCalledWith("find missing citations in Zotero", expect.any(Error));
  });

  it("shows why the entries could not be written", async () => {
    mocks.findMissingInZotero.mockResolvedValue({ found: [pick("a")], duplicates: [], missing: [] });
    mocks.ensureZoteroEntries.mockResolvedValue({ added: [], reused: [], error: "read only" });
    render(<ZoteroDialogs />);
    open("missing");
    fireEvent.click(await screen.findByTestId("zotero-missing-confirm"));

    expect(await screen.findByRole("alert")).toHaveTextContent("read only");
  });

  it("shows why adding the entries threw", async () => {
    mocks.findMissingInZotero.mockResolvedValue({ found: [pick("a")], duplicates: [], missing: [] });
    mocks.ensureZoteroEntries.mockRejectedValue(new Error("disk full"));
    render(<ZoteroDialogs />);
    open("missing");
    fireEvent.click(await screen.findByTestId("zotero-missing-confirm"));

    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
    expect(mocks.logError).toHaveBeenCalledWith("add missing citations from Zotero", expect.any(Error));
  });
});

describe("updating .bib entries from Zotero", () => {
  it("leaves hand-edited entries unticked and updates the ticked ones", async () => {
    mocks.staleZoteroEntries.mockResolvedValue([stale("a"), stale("b", true)]);
    mocks.updateZoteroEntries.mockResolvedValue({ updated: ["a", "b"] });
    render(<ZoteroDialogs />);
    open("update");

    expect(await screen.findByText(update.handEditedNote)).toBeInTheDocument();
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes[0]).toHaveAttribute("data-state", "checked");
    expect(boxes[1]).toHaveAttribute("data-state", "unchecked");

    fireEvent.click(boxes[1]);
    fireEvent.click(screen.getByTestId("zotero-update-confirm"));

    expect(await screen.findByText("Updated 2 entries.")).toBeInTheDocument();
    expect(mocks.updateZoteroEntries).toHaveBeenCalledWith([stale("a"), stale("b", true)]);
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("turns the update off when nothing is ticked", async () => {
    mocks.staleZoteroEntries.mockResolvedValue([stale("a")]);
    render(<ZoteroDialogs />);
    open("update");
    fireEvent.click((await screen.findAllByRole("checkbox"))[0]);

    expect(screen.getByTestId("zotero-update-confirm")).toBeDisabled();
  });

  it("says when the bibliography already matches Zotero", async () => {
    mocks.staleZoteroEntries.mockResolvedValue([]);
    render(<ZoteroDialogs />);
    open("update");

    expect(await screen.findByText(update.none)).toBeInTheDocument();
  });

  it("shows why the check failed", async () => {
    mocks.staleZoteroEntries.mockRejectedValue(new Error("offline"));
    render(<ZoteroDialogs />);
    open("update");

    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
  });

  it("shows why the update failed and still checks again", async () => {
    mocks.staleZoteroEntries.mockResolvedValue([stale("a")]);
    mocks.updateZoteroEntries.mockRejectedValue(new Error("locked"));
    render(<ZoteroDialogs />);
    open("update");
    fireEvent.click(await screen.findByTestId("zotero-update-confirm"));

    expect(await screen.findByRole("alert")).toHaveTextContent("locked");
    expect(mocks.logError).toHaveBeenCalledWith("update entries from Zotero", expect.any(Error));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });
});

describe("choosing the bibliography for new entries", () => {
  it("picks the first file by default and returns the reader's choice", async () => {
    render(<ZoteroDialogs />);
    let answer: Promise<string | null> = Promise.resolve(null);
    act(() => {
      answer = useZoteroDialogStore.getState().chooseBibliography(["refs.bib", "extra.bib"]);
    });

    expect(screen.getByText(choose.title)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "extra.bib" }));
    fireEvent.click(screen.getByRole("button", { name: choose.confirm }));

    await expect(answer).resolves.toBe("extra.bib");
  });

  it("answers nothing when the reader cancels", async () => {
    render(<ZoteroDialogs />);
    let answer: Promise<string | null> = Promise.resolve("unset");
    act(() => {
      answer = useZoteroDialogStore.getState().chooseBibliography(["refs.bib"]);
    });
    fireEvent.click(screen.getByText(enCommon.actions.cancel, { selector: "button" }));

    await expect(answer).resolves.toBeNull();
  });
});

describe("replacing a hand-edited entry", () => {
  it("asks before replacing and passes on the answer", async () => {
    render(<ZoteroDialogs />);
    let answer: Promise<boolean> = Promise.resolve(false);
    act(() => {
      answer = useZoteroDialogStore.getState().confirmHandEdits([stale("efron1979", true)]);
    });

    expect(screen.getByText(handEdits.description.replace("{{key}}", "efron1979"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: handEdits.confirm }));

    await expect(answer).resolves.toBe(true);
  });

  it("keeps the reader's edits when they decline", async () => {
    render(<ZoteroDialogs />);
    let answer: Promise<boolean> = Promise.resolve(true);
    act(() => {
      answer = useZoteroDialogStore.getState().confirmHandEdits([stale("efron1979", true)]);
    });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${handEdits.cancel}`) }));

    await expect(answer).resolves.toBe(false);
  });
});
