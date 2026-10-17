import { describe, expect, it, vi } from "vitest";
import { LocalDocumentSession, type RemoteChange } from "./document-session";

describe("LocalDocumentSession", () => {
  it("starts at version 0 with the text it was given", () => {
    const session = new LocalDocumentSession("main.tex", "hello");
    expect(session.path).toBe("main.tex");
    expect(session.readOnly).toBe(false);
    expect(session.version()).toBe(0);
    expect(session.text()).toBe("hello");
  });

  it("applies a batch of local edits on the original text as one version", () => {
    const session = new LocalDocumentSession("main.tex", "hello world");
    session.applyLocal(
      [
        { from: 0, to: 5, insert: "HELLO" },
        { from: 11, to: 11, insert: "!" },
      ],
      0,
    );
    expect(session.text()).toBe("HELLO world!");
    expect(session.version()).toBe(1);
  });

  it("never echoes local edits to subscribers", () => {
    const session = new LocalDocumentSession("main.tex", "a");
    const listener = vi.fn();
    session.subscribe(listener);
    session.applyLocal([{ from: 1, to: 1, insert: "b" }], 0);
    expect(listener).not.toHaveBeenCalled();
    expect(session.text()).toBe("ab");
  });

  it("sends remote edits to every subscriber after the text has changed", () => {
    const session = new LocalDocumentSession("main.tex", "ac");
    const seen: Array<[RemoteChange, string]> = [];
    session.subscribe((change) => seen.push([change, session.text()]));
    session.subscribe((change) => seen.push([change, session.text()]));
    session.pushRemote([{ from: 1, to: 1, insert: "b" }]);
    expect(seen).toEqual([
      [{ edits: [{ from: 1, to: 1, insert: "b" }], version: 1 }, "abc"],
      [{ edits: [{ from: 1, to: 1, insert: "b" }], version: 1 }, "abc"],
    ]);
  });

  it("stops sending to a listener once it unsubscribes", () => {
    const session = new LocalDocumentSession("main.tex", "");
    const listener = vi.fn();
    const stop = session.subscribe(listener);
    stop();
    session.pushRemote([{ from: 0, to: 0, insert: "x" }]);
    expect(listener).not.toHaveBeenCalled();
    expect(session.text()).toBe("x");
  });

  it("delivers a change to every listener that was subscribed when it arrived", () => {
    const session = new LocalDocumentSession("main.tex", "");
    const later = vi.fn();
    const stopLater = { current: () => {} };
    session.subscribe(() => stopLater.current());
    stopLater.current = session.subscribe(later);
    session.pushRemote([{ from: 0, to: 0, insert: "x" }]);
    expect(later).toHaveBeenCalledOnce();
    session.pushRemote([{ from: 1, to: 1, insert: "y" }]);
    expect(later).toHaveBeenCalledOnce();
  });

  it("ignores an empty batch without starting a new version", () => {
    const session = new LocalDocumentSession("main.tex", "a");
    const listener = vi.fn();
    session.subscribe(listener);
    session.applyLocal([], 0);
    session.pushRemote([]);
    expect(session.version()).toBe(0);
    expect(listener).not.toHaveBeenCalled();
  });

  it("refuses local edits made against an older version", () => {
    const session = new LocalDocumentSession("main.tex", "a");
    session.pushRemote([{ from: 0, to: 0, insert: "b" }]);
    expect(() => session.applyLocal([{ from: 0, to: 0, insert: "c" }], 0)).toThrow(
      "Edits to main.tex are based on version 0, but the document is at version 1.",
    );
    expect(session.text()).toBe("ba");
  });

  it("refuses edits that are out of order, outside the text or not whole numbers", () => {
    const session = new LocalDocumentSession("main.tex", "abcdef");
    const invalid = [
      [{ from: -1, to: 0, insert: "" }],
      [{ from: 2, to: 1, insert: "" }],
      [{ from: 0, to: 7, insert: "" }],
      [
        { from: 3, to: 4, insert: "" },
        { from: 1, to: 2, insert: "" },
      ],
      [{ from: 1.5, to: 2, insert: "" }],
      [{ from: 1, to: Number.NaN, insert: "" }],
    ];
    for (const edits of invalid) {
      expect(() => session.pushRemote(edits)).toThrow(RangeError);
    }
    expect(session.text()).toBe("abcdef");
    expect(session.version()).toBe(0);
  });

  it("refuses local edits to a read-only document but takes remote ones", () => {
    const session = new LocalDocumentSession("main.tex", "a", true);
    expect(session.readOnly).toBe(true);
    expect(() => session.applyLocal([{ from: 1, to: 1, insert: "b" }], 0)).toThrow("main.tex is read-only.");
    session.pushRemote([{ from: 1, to: 1, insert: "b" }]);
    expect(session.text()).toBe("ab");
  });
});

describe("UTF-16 offsets in a session", () => {
  it("edits right next to an emoji without splitting its surrogate pair", () => {
    const session = new LocalDocumentSession("main.tex", "a😀b");
    session.applyLocal([{ from: 3, to: 3, insert: "!" }], 0);
    expect(session.text()).toBe("a😀!b");
    session.pushRemote([{ from: 1, to: 3, insert: "🌿" }]);
    expect(session.text()).toBe("a🌿!b");
    expect(() => session.pushRemote([{ from: 2, to: 2, insert: "x" }])).toThrow(
      "Edits must not split a surrogate pair.",
    );
    expect(() => session.pushRemote([{ from: 1, to: 2, insert: "" }])).toThrow(
      "Edits must not split a surrogate pair.",
    );
    expect(session.text()).toBe("a🌿!b");
  });

  it("holds a CRLF file as LF text so offsets match what the editor shows", () => {
    const session = new LocalDocumentSession("main.tex", "one\r\ntwo\r\nthree\rfour");
    expect(session.text()).toBe("one\ntwo\nthree\nfour");
    const two = session.text().indexOf("two");
    expect(two).toBe(4);
    session.applyLocal([{ from: two, to: two + 3, insert: "TWO" }], 0);
    expect(session.text()).toBe("one\nTWO\nthree\nfour");
    expect(() => session.pushRemote([{ from: 0, to: 0, insert: "zero\r\n" }])).toThrow(
      "Edits must use LF line breaks.",
    );
    expect(() => session.applyLocal([{ from: 0, to: 0, insert: "\r" }], 1)).toThrow(
      "Edits must use LF line breaks.",
    );
  });
});
