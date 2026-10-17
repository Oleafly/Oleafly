import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ZoteroHit } from "@oleafly/backend-port";

const mocks = vi.hoisted(() => ({
  projectId: "project-a" as string | null,
  staleZoteroEntries: vi.fn(),
  ensureZoteroEntries: vi.fn(),
  requestZoteroUpdate: vi.fn(),
  unresolvedCitationKeys: vi.fn((): string[] => []),
  citationKeyForHit: vi.fn((hit: { key: string }) => `key-${hit.key}`),
  insertCitationKey: vi.fn((_key: string): string | null => "\\cite{key}"),
  zoteroLibraryLookup: vi.fn(),
  zoteroHasKey: vi.fn((_key: string) => false),
  chooseBibliography: vi.fn(async () => "refs.bib"),
  confirmHandEdits: vi.fn(async () => true),
  openBulk: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  logError: vi.fn(async () => {}),
}));

vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => ({ projectId: mocks.projectId }) },
}));
vi.mock("@/store/zotero-dialogs", () => ({
  useZoteroDialogStore: {
    getState: () => ({
      chooseBibliography: mocks.chooseBibliography,
      confirmHandEdits: mocks.confirmHandEdits,
      openBulk: mocks.openBulk,
    }),
  },
}));
vi.mock("@/store/zotero-library", () => ({ zoteroHasKey: mocks.zoteroHasKey }));
vi.mock("@/lib/tauri", () => ({ zoteroLibraryLookup: mocks.zoteroLibraryLookup }));
vi.mock("@/lib/toast", () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("./cite-insert", () => ({ insertCitationKey: mocks.insertCitationKey }));
vi.mock("./zotero-cite", () => ({
  citationKeyForHit: mocks.citationKeyForHit,
  ensureZoteroEntries: mocks.ensureZoteroEntries,
  requestZoteroUpdate: mocks.requestZoteroUpdate,
  staleZoteroEntries: mocks.staleZoteroEntries,
  unresolvedCitationKeys: mocks.unresolvedCitationKeys,
}));

import {
  addCitedKeyFromZotero,
  insertZoteroCitation,
  missingKeysInZotero,
  openMissingCitations,
  openZoteroUpdates,
  staleEntryFor,
  updateEntryFromZotero,
  useZoteroStaleStore,
} from "./zotero-actions";

const entry = (key: string, handEdited = false) => ({ key, bib: "refs.bib", handEdited }) as never;
const hit = { key: "ABCD1234" } as unknown as ZoteroHit;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.projectId = "project-a";
  mocks.insertCitationKey.mockReturnValue("\\cite{key}");
  mocks.zoteroHasKey.mockReturnValue(false);
  mocks.staleZoteroEntries.mockResolvedValue([]);
  mocks.ensureZoteroEntries.mockResolvedValue({ added: [], reused: [], bibPath: "refs.bib" });
  useZoteroStaleStore.setState({ projectId: null, entries: [], revision: 0 });
});

describe("changed Zotero entries", () => {
  it("records the open project's changed entries once", async () => {
    mocks.staleZoteroEntries.mockResolvedValue([entry("a"), entry("b", true)]);

    await useZoteroStaleStore.getState().refresh();
    await useZoteroStaleStore.getState().refresh();

    const state = useZoteroStaleStore.getState();
    expect(state.projectId).toBe("project-a");
    expect(state.entries.map((item) => item.key)).toEqual(["a", "b"]);
    expect(state.revision).toBe(1);
  });

  it("publishes again when an entry becomes hand-edited", async () => {
    mocks.staleZoteroEntries.mockResolvedValueOnce([entry("a")]).mockResolvedValueOnce([entry("a", true)]);

    await useZoteroStaleStore.getState().refresh();
    await useZoteroStaleStore.getState().refresh();

    expect(useZoteroStaleStore.getState().revision).toBe(2);
  });

  it("has nothing to check without an open project", async () => {
    mocks.projectId = null;

    await useZoteroStaleStore.getState().refresh();

    expect(mocks.staleZoteroEntries).not.toHaveBeenCalled();
    expect(useZoteroStaleStore.getState()).toMatchObject({ projectId: null, entries: [], revision: 0 });
  });

  it("drops a result that finishes after another project opened", async () => {
    let finish: (value: unknown) => void = () => {};
    mocks.staleZoteroEntries.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const pending = useZoteroStaleStore.getState().refresh();

    mocks.projectId = "project-b";
    finish([entry("a")]);
    await pending;

    expect(useZoteroStaleStore.getState().entries).toEqual([]);
  });

  it("runs one more check when asked again while a check is running", async () => {
    let finish: (value: unknown) => void = () => {};
    mocks.staleZoteroEntries
      .mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
      .mockResolvedValueOnce([entry("late")]);
    const first = useZoteroStaleStore.getState().refresh();
    const second = useZoteroStaleStore.getState().refresh();
    expect(mocks.staleZoteroEntries).toHaveBeenCalledTimes(1);

    finish([entry("early")]);
    await Promise.all([first, second]);
    await settle();

    expect(mocks.staleZoteroEntries).toHaveBeenCalledTimes(2);
    expect(useZoteroStaleStore.getState().entries.map((item) => item.key)).toEqual(["late"]);
  });

  it("logs a failed check and keeps what it had", async () => {
    mocks.staleZoteroEntries.mockRejectedValue(new Error("offline"));

    await useZoteroStaleStore.getState().refresh();

    expect(mocks.logError).toHaveBeenCalledWith("check Zotero for changed entries", expect.any(Error));
    expect(useZoteroStaleStore.getState().revision).toBe(0);
  });

  it("finds a changed entry only for the open project", () => {
    useZoteroStaleStore.setState({ projectId: "project-a", entries: [entry("a")], revision: 1 });

    expect(staleEntryFor("refs.bib", "a")).toMatchObject({ key: "a" });
    expect(staleEntryFor("refs.bib", "b")).toBeNull();
    mocks.projectId = "project-b";
    expect(staleEntryFor("refs.bib", "a")).toBeNull();
  });
});

describe("cited keys", () => {
  it("lists only the unresolved keys that Zotero has", () => {
    mocks.unresolvedCitationKeys.mockReturnValue(["known", "unknown"]);
    mocks.zoteroHasKey.mockImplementation((key) => key === "known");

    expect(missingKeysInZotero()).toEqual(["known"]);
  });

  it("says when a key is not in the Zotero library", async () => {
    mocks.zoteroLibraryLookup.mockResolvedValue([]);

    await addCitedKeyFromZotero("ghost");

    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(mocks.ensureZoteroEntries).not.toHaveBeenCalled();
  });

  it("adds a key that Zotero has and checks for changes again", async () => {
    mocks.zoteroLibraryLookup.mockResolvedValue([hit]);

    await addCitedKeyFromZotero("efron1979");

    expect(mocks.ensureZoteroEntries).toHaveBeenCalledWith(
      [{ hit, key: "efron1979" }],
      expect.objectContaining({ chooseBibliography: expect.any(Function) }),
    );
    const options = mocks.ensureZoteroEntries.mock.calls[0][1] as { chooseBibliography: (choices: string[]) => unknown };
    await options.chooseBibliography(["a.bib", "b.bib"]);
    expect(mocks.chooseBibliography).toHaveBeenCalledWith(["a.bib", "b.bib"]);
    expect(mocks.toastError).not.toHaveBeenCalled();
    await settle();
    expect(mocks.staleZoteroEntries).toHaveBeenCalled();
  });

  it("reports a key that could not be written", async () => {
    mocks.zoteroLibraryLookup.mockResolvedValue([hit]);
    mocks.ensureZoteroEntries.mockResolvedValue({ added: [], reused: [], error: "read only" });

    await addCitedKeyFromZotero("efron1979");

    expect(mocks.toastError).toHaveBeenCalledTimes(1);
  });

  it("logs and reports a lookup that fails", async () => {
    mocks.zoteroLibraryLookup.mockRejectedValue(new Error("Zotero closed"));

    await addCitedKeyFromZotero("efron1979");

    expect(mocks.logError).toHaveBeenCalledWith("add a cited key from Zotero", expect.any(Error));
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
  });
});

describe("updating an entry from Zotero", () => {
  it("confirms an update", async () => {
    mocks.requestZoteroUpdate.mockImplementation(async (_key: string, confirm: (entries: unknown) => unknown) => {
      await confirm([entry("a", true)]);
      return "updated";
    });

    await updateEntryFromZotero("a");

    expect(mocks.confirmHandEdits).toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
    await settle();
    expect(mocks.staleZoteroEntries).toHaveBeenCalled();
  });

  it("reports a failed update", async () => {
    mocks.requestZoteroUpdate.mockResolvedValue("failed");

    await updateEntryFromZotero("a");

    expect(mocks.toastError).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when the reader keeps their edits", async () => {
    mocks.requestZoteroUpdate.mockResolvedValue("cancelled");

    await updateEntryFromZotero("a");

    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("logs and reports an update that throws", async () => {
    mocks.requestZoteroUpdate.mockRejectedValue(new Error("boom"));

    await updateEntryFromZotero("a");

    expect(mocks.logError).toHaveBeenCalledWith("update an entry from Zotero", expect.any(Error));
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
  });
});

describe("bulk dialogs", () => {
  it("opens the missing-citations and update lists", () => {
    openMissingCitations();
    openZoteroUpdates();

    expect(mocks.openBulk.mock.calls).toEqual([["missing"], ["update"]]);
  });
});

describe("inserting a Zotero citation", () => {
  it("does nothing when there is no place to cite", () => {
    mocks.insertCitationKey.mockReturnValue(null);

    expect(insertZoteroCitation(hit)).toBeNull();
    expect(mocks.ensureZoteroEntries).not.toHaveBeenCalled();
  });

  it("inserts the citation and adds the entry", async () => {
    expect(insertZoteroCitation(hit)).toBe("\\cite{key}");
    await settle();

    expect(mocks.insertCitationKey).toHaveBeenCalledWith("key-ABCD1234");
    expect(mocks.ensureZoteroEntries).toHaveBeenCalledWith([{ hit, key: "key-ABCD1234" }], expect.any(Object));
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("reports an entry that could not be added", async () => {
    mocks.ensureZoteroEntries.mockResolvedValue({ added: [], reused: [], error: "read only" });

    insertZoteroCitation(hit);
    await settle();

    expect(mocks.toastError).toHaveBeenCalledTimes(1);
  });

  it("logs and reports an add that throws", async () => {
    mocks.ensureZoteroEntries.mockRejectedValue(new Error("disk full"));

    insertZoteroCitation(hit);
    await settle();

    expect(mocks.logError).toHaveBeenCalledWith("add a Zotero citation", expect.any(Error));
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
  });
});
