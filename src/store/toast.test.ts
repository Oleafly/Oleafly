import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "@/lib/toast";
import { TOAST_LIMIT, TOAST_QUIET_MS, useToastStore } from "@/store/toast";

const KEEP_MESSAGE = "Keep this toast";
const CHOOSE_MESSAGE = "Choose a compatible engine";
const SAVE_FAILED = "Could not save main.tex.";
const OTHER_FAILURE = "The disk is full.";
const INSTALLING = "Installing TinyTeX…";
const INSTALLED = "TinyTeX is ready.";
const EXPORTED = "Export finished.";
const EXPORTING = "Exporting…";
const SAVED = "Saved.";
const SAVING = "Saving…";
const DOWNLOADING = "Downloading 40%";
const COMPILING = "Compiling…";
const RESTART = "Restart to update";
const CHOOSE_ENGINE = "Choose an engine";
const FIRST = "First";
const SECOND = "Second";
const ONE = "One";
const TWO = "Two";
const THREE = "Three";
const FOUR = "Four";
const FIVE = "Five";

const toasts = () => useToastStore.getState().toasts;
const close = (id: number) => useToastStore.getState().close(id);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-23T10:00:00Z"));
  useToastStore.getState().reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("keyed toasts", () => {
  it("updates an existing toast instead of stacking a duplicate", () => {
    const firstAction = vi.fn();
    const latestAction = vi.fn();

    toast.infoUnique("unrelated", KEEP_MESSAGE);
    const firstId = toast.infoUnique(
      "engine-compatibility:project-1",
      CHOOSE_MESSAGE,
      { label: "Choose engine…", onClick: firstAction },
      true,
    );
    const latestId = toast.infoUnique(
      "engine-compatibility:project-1",
      CHOOSE_MESSAGE,
      { label: "Choose engine…", onClick: latestAction },
      true,
    );

    expect(latestId).toBe(firstId);
    expect(toasts()).toHaveLength(2);
    expect(toasts()[0]?.message).toBe(KEEP_MESSAGE);
    expect(toasts()[1]?.action?.onClick).toBe(latestAction);
  });

  it("replaces the slot content and restarts the count when the text changes", () => {
    const id = toast.infoUnique("install", INSTALLING, undefined, true);
    toast.infoUnique("install", INSTALLING, undefined, true);
    expect(toasts()[0]?.count).toBe(2);

    const same = useToastStore.getState().pushUnique("install", "success", INSTALLED);

    expect(same).toBe(id);
    expect(toasts()).toEqual([
      expect.objectContaining({ id, key: "install", kind: "success", message: INSTALLED, count: 1 }),
    ]);
    expect(toasts()[0]?.sticky).toBeUndefined();
  });

  it("joins a visible toast with the same text and takes over its key", () => {
    const plain = toast.error(SAVE_FAILED);
    const keyed = toast.errorUnique("save:main", SAVE_FAILED);

    expect(keyed).toBe(plain);
    expect(toasts()).toEqual([
      expect.objectContaining({ id: plain, key: "save:main", count: 2 }),
    ]);
  });

  it("drops a duplicate when a keyed toast changes to the same text", () => {
    toast.error(OTHER_FAILURE);
    const keyed = toast.errorUnique("save:main", SAVE_FAILED);

    toast.errorUnique("save:main", OTHER_FAILURE);

    expect(toasts()).toEqual([
      expect.objectContaining({ id: keyed, message: OTHER_FAILURE, count: 2 }),
    ]);
  });

  it("ignores the quiet period while the keyed slot is still on screen", () => {
    const done = toast.info(EXPORTED);
    close(done);
    const slot = toast.infoUnique("export", EXPORTING, undefined, true);

    toast.infoUnique("export", EXPORTED);

    expect(toasts()).toEqual([
      expect.objectContaining({ id: slot, message: EXPORTED, count: 1 }),
    ]);
  });
});

describe("identical toasts", () => {
  it("merge into one entry instead of stacking", () => {
    const first = toast.error(SAVE_FAILED);
    const before = toasts()[0];
    const second = toast.error(SAVE_FAILED);
    const third = toast.error(SAVE_FAILED);

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]).toMatchObject({ id: first, count: 3 });
    expect(toasts()[0]).not.toBe(before);
  });

  it("stay separate when the kind or the text differs", () => {
    toast.error(SAVE_FAILED);
    toast.info(SAVE_FAILED);
    toast.error(OTHER_FAILURE);

    expect(toasts().map((item) => [item.kind, item.message, item.count])).toEqual([
      ["error", SAVE_FAILED, 1],
      ["info", SAVE_FAILED, 1],
      ["error", OTHER_FAILURE, 1],
    ]);
  });

  it("keep the newest action and never drop an action or stickiness on repeat", () => {
    const first = vi.fn();
    const latest = vi.fn();
    toast.error(SAVE_FAILED, { label: "Retry", onClick: first });
    toast.error(SAVE_FAILED, { label: "Retry", onClick: latest }, true);
    expect(toasts()[0]).toMatchObject({ action: { onClick: latest }, sticky: true });

    toast.error(SAVE_FAILED);

    expect(toasts()[0]).toMatchObject({ action: { onClick: latest }, sticky: true, count: 3 });
  });

  it("move a repeated toast to the newest position", () => {
    const older = toast.info(FIRST);
    toast.info(SECOND);

    toast.info(FIRST);

    expect(toasts().map((item) => item.id)).toEqual([expect.any(Number), older]);
  });

  it("merge when an update gives a toast the text of another visible toast", () => {
    toast.info(SAVED);
    toast.success(SAVED);
    const progress = toast.info(SAVING, undefined, true);

    toast.update(progress, SAVED);

    expect(toasts()).toEqual([
      expect.objectContaining({ kind: "success", message: SAVED }),
      expect.objectContaining({ id: progress, kind: "info", message: SAVED, count: 2 }),
    ]);
  });

  it("leave a toast untouched when an update repeats its text", () => {
    const id = toast.info(DOWNLOADING, undefined, true);
    const before = toasts()[0];

    toast.update(id, DOWNLOADING);

    expect(toasts()[0]).toBe(before);
  });
});

describe("quiet period", () => {
  it("holds back the same toast right after it closed on screen", () => {
    const id = toast.error(SAVE_FAILED);
    close(id);

    const again = toast.error(SAVE_FAILED);

    expect(again).not.toBe(id);
    expect(toasts()).toEqual([]);
    toast.update(again, OTHER_FAILURE);
    toast.dismiss(again);
    expect(toasts()).toEqual([]);
  });

  it("lets the same toast show again once the window has passed", () => {
    close(toast.error(SAVE_FAILED));

    vi.advanceTimersByTime(TOAST_QUIET_MS - 1);
    toast.error(SAVE_FAILED);
    expect(toasts()).toEqual([]);

    vi.advanceTimersByTime(1);
    toast.error(SAVE_FAILED);
    expect(toasts()).toEqual([expect.objectContaining({ message: SAVE_FAILED, count: 1 })]);
  });

  it("never holds back a different text or a different kind", () => {
    close(toast.error(SAVE_FAILED));

    toast.error(OTHER_FAILURE);
    toast.info(SAVE_FAILED);

    expect(toasts().map((item) => [item.kind, item.message])).toEqual([
      ["error", OTHER_FAILURE],
      ["info", SAVE_FAILED],
    ]);
  });

  it("does not start when code dismisses the toast", () => {
    const id = toast.info(COMPILING, undefined, true);
    toast.dismiss(id);

    toast.info(COMPILING, undefined, true);

    expect(toasts()).toEqual([expect.objectContaining({ message: COMPILING })]);
  });

  it("does not start when the toast is already gone", () => {
    const id = toast.error(SAVE_FAILED);
    toast.dismiss(id);
    close(id);

    toast.error(SAVE_FAILED);

    expect(toasts()).toHaveLength(1);
    expect(useToastStore.getState().quietUntil).toEqual({});
  });

  it("covers keyed toasts by their text", () => {
    close(toast.errorUnique("query:projects", SAVE_FAILED));

    toast.errorUnique("query:projects", SAVE_FAILED);
    expect(toasts()).toEqual([]);

    toast.errorUnique("query:projects", OTHER_FAILURE);
    expect(toasts()).toEqual([expect.objectContaining({ key: "query:projects", message: OTHER_FAILURE })]);
  });

  it("forgets expired windows the next time a toast closes", () => {
    close(toast.error(SAVE_FAILED));
    vi.advanceTimersByTime(TOAST_QUIET_MS + 1);

    close(toast.error(OTHER_FAILURE));

    expect(Object.keys(useToastStore.getState().quietUntil)).toEqual([`error:${OTHER_FAILURE}`]);
  });
});

describe("stack limit", () => {
  it(`keeps at most ${TOAST_LIMIT} toasts and drops the oldest`, () => {
    const ids = [ONE, TWO, THREE, FOUR, FIVE].map((message) => toast.info(message));

    expect(toasts().map((item) => item.id)).toEqual(ids.slice(1));
  });

  it("drops transient toasts before sticky ones", () => {
    const sticky = toast.info(RESTART, { label: "Restart", onClick: vi.fn() }, true);
    toast.info(TWO);
    toast.info(THREE);
    toast.info(FOUR);

    toast.info(FIVE);

    expect(toasts().map((item) => item.message)).toEqual([RESTART, THREE, FOUR, FIVE]);
    expect(toasts()[0]?.id).toBe(sticky);
  });

  it("still shows the newest toast when every other toast is sticky", () => {
    for (const message of [ONE, TWO, THREE, FOUR]) toast.info(message, undefined, true);

    const newest = toast.error(SAVE_FAILED);

    expect(toasts()).toHaveLength(TOAST_LIMIT);
    expect(toasts().map((item) => item.message)).toEqual([TWO, THREE, FOUR, SAVE_FAILED]);
    expect(toasts()[3]?.id).toBe(newest);
  });

  it("does not count a merged repeat as a new toast", () => {
    for (const message of [ONE, TWO, THREE, FOUR]) toast.info(message);

    toast.info(ONE);

    expect(toasts().map((item) => item.message)).toEqual([TWO, THREE, FOUR, ONE]);
  });
});

describe("sticky toasts", () => {
  it("stay sticky when a repeat does not ask for it", () => {
    toast.info(CHOOSE_ENGINE, undefined, true);

    toast.info(CHOOSE_ENGINE);

    expect(toasts()).toEqual([expect.objectContaining({ sticky: true, count: 2 })]);
  });

  it("start the quiet period when the user closes them", () => {
    const id = toast.info(CHOOSE_ENGINE, undefined, true);
    close(id);

    toast.info(CHOOSE_ENGINE, undefined, true);

    expect(toasts()).toEqual([]);
  });
});
