// @vitest-environment jsdom

import { EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { create } from "zustand";
import { remoteChange } from "../../packages/editor/src/collaboration";
import type { RemoteChange } from "../../packages/editor/src/document-session";
import { type PathViewState, remotePathViewState } from "../../packages/editor/src/path-view-state";
import { remoteCursors, type RemoteCursor } from "../../src/features/collab/live/remote-cursors";
import { RemoteDocumentSession } from "../../src/features/collab/live/remote-session";
import type { CollabDocMessage } from "../../src/lib/tauri";

// Budgets for the per-edit work shared documents do on the UI thread. Each one
// has room for a slow CI runner, but a path that does work in proportion to
// the file again (a background tab that rebuilds its state from a string, a
// session that copies its text twice per edit) overshoots it many times over.
const LARGE_BYTES = 5 * 1024 * 1024;
const REMOTE_EDITS = 200;
const ACTIVE_LARGE_BUDGET_MS = 3_000;
const BACKGROUND_LARGE_BUDGET_MS = 250;
const LONG_DOCUMENT_LINES = 2_000;
const LONG_DOCUMENT_EDITS = 500;
const LONG_DOCUMENT_BUDGET_MS = 2_500;
const PEERS = 10;
const STORE_LISTENERS = 40;

function largeBibliography(): string {
  const entry = (index: number) =>
    `@article{key${index},\n  author = {Ada Author and Ben Builder},\n  title = {A Study of Shared Editing, Part ${index}},\n  year = {2026}\n}\n`;
  const parts: string[] = [];
  let length = 0;
  for (let index = 0; length < LARGE_BYTES; index += 1) {
    const part = entry(index);
    parts.push(part);
    length += part.length;
  }
  return parts.join("");
}

function longDocument(): string {
  return Array.from(
    { length: LONG_DOCUMENT_LINES },
    (_, index) => `Line ${index}: lorem ipsum dolor sit amet, consectetur adipiscing elit.`,
  ).join("\n");
}

function randomFrom(seed: number): (limit: number) => number {
  let state = seed;
  return (limit) => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state % limit;
  };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

async function openSession(text: string, mirror: (text: string) => void) {
  let deliver: (message: CollabDocMessage) => void = () => {};
  const session = new RemoteDocumentSession("refs.bib", text, {
    transport: {
      open: async (_path, onMessage) => {
        deliver = onMessage;
        return { file_id: "file", rev: 0, text };
      },
      change: () => undefined,
      close: () => undefined,
    },
    onText: mirror,
  });
  await session.open();
  return { session, deliver: (message: CollabDocMessage) => deliver(message) };
}

// Alternating one-character inserts and deletes at pseudo-random places, as
// collaborators typing elsewhere in the file would send them.
function remoteEdits(length: number, count: number, seed: number) {
  const random = randomFrom(seed);
  const messages: CollabDocMessage[] = [];
  let size = length;
  for (let index = 0; index < count; index += 1) {
    const at = random(size - 2);
    if (index % 2 === 0) {
      messages.push({ kind: "remote", rev: index + 1, op: [at, "x", size - at], length: size + 1 });
      size += 1;
    } else {
      messages.push({ kind: "remote", rev: index + 1, op: [at, -1, size - at - 1], length: size - 1 });
      size -= 1;
    }
  }
  return messages;
}

function applyToState(state: EditorState, change: RemoteChange): EditorState {
  return state.update({
    changes: change.edits,
    annotations: [remoteChange.of(true), Transaction.addToHistory.of(false)],
    filter: false,
  }).state;
}

describe("shared document performance", () => {
  it("applies remote edits to an open 5 MB shared file without copying it per edit", async () => {
    const text = largeBibliography();
    const files = create(() => ({ content: text }));
    for (let index = 0; index < STORE_LISTENERS; index += 1) files.subscribe(() => undefined);
    const { session, deliver } = await openSession(text, (next) =>
      files.setState((state) => (state.content === next ? state : { content: next })),
    );
    let editor = EditorState.create({ doc: text });
    session.subscribe((change) => {
      editor = applyToState(editor, change);
    });
    const messages = remoteEdits(text.length, REMOTE_EDITS, 7);

    const started = performance.now();
    for (const message of messages) deliver(message);
    const elapsed = performance.now() - started;

    expect(session.phase).toBe("open");
    expect(editor.doc.length).toBe(session.text().length);
    expect(files.getState().content).toBe(session.text());
    console.info("[shared-editing] active 5 MB file", { totalMs: Math.round(elapsed), edits: REMOTE_EDITS });
    expect(elapsed).toBeLessThanOrEqual(ACTIVE_LARGE_BUDGET_MS);
    session.close();
  });

  it("keeps a 5 MB file in a background tab up to date at the cost of each edit", () => {
    const text = largeBibliography();
    const state = EditorState.create({ doc: text });
    let saved: PathViewState = { state, scroll: EditorView.scrollIntoView(0) };
    const random = randomFrom(11);
    let length = text.length;
    const edits = Array.from({ length: REMOTE_EDITS }, (_, index) => {
      const at = random(length - 2);
      if (index % 2 === 0) {
        length += 1;
        return [{ from: at, to: at, insert: "x" }];
      }
      length -= 1;
      return [{ from: at, to: at + 1, insert: "" }];
    });

    const started = performance.now();
    for (const edit of edits) saved = remotePathViewState(saved, edit);
    const elapsed = performance.now() - started;

    expect(saved.state.doc.length).toBe(length);
    console.info("[shared-editing] background 5 MB file", { totalMs: Math.round(elapsed), edits: REMOTE_EDITS });
    expect(elapsed).toBeLessThanOrEqual(BACKGROUND_LARGE_BUDGET_MS);
  });

  it("keeps a long open document with ten remote cursors in step at a hundred remote edits a second", async () => {
    const text = longDocument();
    const files = create(() => ({ content: text }));
    for (let index = 0; index < STORE_LISTENERS; index += 1) files.subscribe(() => undefined);
    const { session, deliver } = await openSession(text, (next) =>
      files.setState((state) => (state.content === next ? state : { content: next })),
    );
    const cursors: RemoteCursor[] = Array.from({ length: PEERS }, (_, index) => ({
      id: `device-${index}`,
      name: `Person ${index}`,
      hue: index * 30,
      head: index * 9_000,
      anchor: index * 9_000,
    }));
    const view = new EditorView({
      state: EditorState.create({
        doc: text,
        extensions: remoteCursors({ cursors: () => cursors, subscribe: () => () => {} }),
      }),
      parent: document.body,
    });
    session.subscribe((change) =>
      view.dispatch({
        changes: change.edits,
        annotations: [remoteChange.of(true), Transaction.addToHistory.of(false)],
        filter: false,
      }),
    );
    await settle();
    const messages = remoteEdits(text.length, LONG_DOCUMENT_EDITS, 11);

    const started = performance.now();
    for (const message of messages) deliver(message);
    const elapsed = performance.now() - started;

    expect(view.state.doc.length).toBe(session.text().length);
    console.info("[shared-editing] long open document", { totalMs: Math.round(elapsed), edits: LONG_DOCUMENT_EDITS });
    expect(elapsed).toBeLessThanOrEqual(LONG_DOCUMENT_BUDGET_MS);
    view.destroy();
    session.close();
  });
});
