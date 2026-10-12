// @vitest-environment jsdom

import { appendFileSync } from "node:fs";
import { EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { remoteChange } from "@oleafly/editor/collaboration";
import { describe, expect, it } from "vitest";
import { create } from "zustand";
import type { CollabDocMessage } from "@/lib/tauri";
import { remoteCursors, type RemoteCursor } from "./remote-cursors";
import { RemoteDocumentSession } from "./remote-session";

const LINES = 2_000;
const EDITS = 500;
const PEERS = 10;
const SUBSCRIBERS = 40;

function longDocument(): string {
  return Array.from(
    { length: LINES },
    (_, index) => `Line ${index}: lorem ipsum dolor sit amet, consectetur adipiscing elit.`,
  ).join("\n");
}

async function settle(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

interface Setup {
  editor: boolean;
  mirror: boolean;
}

async function run(setup: Setup) {
  const doc = longDocument();
  let deliver: (message: CollabDocMessage) => void = () => {};
  const files = create(() => ({ content: doc }));
  let notified = 0;
  for (let index = 0; index < SUBSCRIBERS; index += 1) {
    files.subscribe(() => {
      notified += 1;
    });
  }
  const session = new RemoteDocumentSession("main.tex", doc, {
    transport: {
      open: async (_path, onMessage) => {
        deliver = onMessage;
        return { file_id: "file", rev: 0, text: doc };
      },
      change: () => undefined,
      close: () => undefined,
    },
    onText: setup.mirror
      ? (text) =>
          files.setState((state) => (state.content === text ? state : { content: text }))
      : undefined,
  });
  await session.open();
  let view: EditorView | null = null;
  if (setup.editor) {
    const cursors: RemoteCursor[] = Array.from({ length: PEERS }, (_, index) => ({
      id: `device-${index}`,
      name: `Person ${index}`,
      hue: index * 30,
      head: index * 9_000,
      anchor: index * 9_000,
    }));
    const editorView = new EditorView({
      state: EditorState.create({
        doc,
        extensions: remoteCursors({ cursors: () => cursors, subscribe: () => () => {} }),
      }),
      parent: document.body,
    });
    view = editorView;
    session.subscribe((change) =>
      editorView.dispatch({
        changes: change.edits,
        annotations: [remoteChange.of(true), Transaction.addToHistory.of(false)],
        filter: false,
      }),
    );
    await settle();
  }
  let seed = 11;
  const random = (limit: number) => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed % limit;
  };
  let length = session.text().length;
  const started = performance.now();
  for (let index = 0; index < EDITS; index += 1) {
    const at = random(length - 2);
    if (index % 2 === 0) {
      deliver({ kind: "remote", rev: index + 1, op: [at, "x", length - at], length: length + 1 });
      length += 1;
    } else {
      deliver({ kind: "remote", rev: index + 1, op: [at, -1, length - at - 1], length: length - 1 });
      length -= 1;
    }
  }
  const elapsed = performance.now() - started;
  const result = {
    perEditUs: Math.round((elapsed * 1_000) / EDITS),
    totalMs: Math.round(elapsed),
    notified,
    synced: view ? view.state.doc.length === session.text().length : true,
  };
  view?.destroy();
  session.close();
  return result;
}

describe.skipIf(!process.env.COLLAB_BENCH_OUT)("remote edit timing", () => {
  it("applies a hundred remote edits a second for five seconds to a long open document", async () => {
    const sessionOnly = await run({ editor: false, mirror: false });
    const withEditor = await run({ editor: true, mirror: false });
    const full = await run({ editor: true, mirror: true });
    appendFileSync(process.env.COLLAB_BENCH_OUT ?? "", `remote ${JSON.stringify({ sessionOnly, withEditor, full })}\n`);
    expect(full.synced).toBe(true);
  }, 60_000);
});
