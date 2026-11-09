import { describe, expect, it, vi } from "vitest";
import { mergeSequences } from "@/components/notes/note-merge";
import { myersEditScript } from "@/lib/myers-diff";
import { TextOperation } from "../live/ot";
import { RemoteDocumentSession } from "../live/remote-session";
import { FakeChannel } from "../live/tests/fake-channel";
import { browserClock, LIVE_SEND_MS, NoteLiveBinding, type NoteLiveClock, type NoteLiveEditor } from "./note-live";

interface Block {
  kind: "p" | "li";
  text: string;
  source: string | null;
}

function parseBlocks(text: string): Block[] {
  return text.split("\n").map((line) => {
    if (/^[*-] /u.test(line)) return { kind: "li", text: line.slice(2).trimEnd(), source: line };
    if (line.startsWith("\\")) return { kind: "p", text: line.slice(1).trimEnd(), source: line };
    return { kind: "p", text: line.trimEnd(), source: line };
  });
}

function fresh(block: Block): string {
  if (block.kind === "li") return `- ${block.text}`;
  return /^(?:[*-] |\\)/u.test(block.text) ? `\\${block.text}` : block.text;
}

function serializeBlocks(blocks: readonly Block[]): string {
  return blocks.map((block) => block.source ?? fresh(block)).join("\n");
}

const keyOf = (block: Block) => `${block.kind}\u0000${block.text}`;

function withSources(blocks: readonly Block[], shown: readonly Block[]): Block[] {
  const mine = blocks.map(keyOf);
  const theirs = shown.map(keyOf);
  const out = blocks.map((block) => ({ ...block, source: null as string | null }));
  let head = 0;
  while (head < mine.length && head < theirs.length && mine[head] === theirs[head]) {
    out[head].source = shown[head].source;
    head += 1;
  }
  let tail = 0;
  while (
    tail < mine.length - head &&
    tail < theirs.length - head &&
    mine[mine.length - 1 - tail] === theirs[theirs.length - 1 - tail]
  ) {
    out[mine.length - 1 - tail].source = shown[theirs.length - 1 - tail].source;
    tail += 1;
  }
  const script = myersEditScript(mine.slice(head, mine.length - tail), theirs.slice(head, theirs.length - tail)) ?? [];
  for (const edit of script) {
    if (edit.kind !== "same") continue;
    for (let offset = 0; offset < edit.length; offset += 1) {
      out[head + edit.oldStart + offset].source = shown[head + edit.newStart + offset].source;
    }
  }
  return out;
}

class FakeEditor implements NoteLiveEditor {
  blocks: Block[];
  isComposing = false;
  shows = 0;

  constructor(text: string) {
    this.blocks = parseBlocks(text);
  }

  serialize(): string {
    return serializeBlocks(this.blocks);
  }

  show(previous: string, next: string, keepLocal: boolean): void {
    if (this.isComposing) throw new Error("The editor changed during a composition.");
    this.shows += 1;
    const theirs = parseBlocks(next);
    const base = parseBlocks(previous);
    const sourceOf = (block: Block) => block.source ?? "";
    const merged = keepLocal
      ? mergeSequences(base, this.blocks, theirs, keyOf, { base: base.map(sourceOf), theirs: theirs.map(sourceOf) })
      : theirs;
    this.blocks = withSources(merged, theirs);
  }

  composing(): boolean {
    return this.isComposing;
  }

  edit(index: number, update: (block: Block) => Partial<Block>): void {
    const block = this.blocks[index];
    this.blocks = this.blocks.map((candidate, at) => (at === index ? { ...block, ...update(block), source: null } : candidate));
  }
}

class ManualClock implements NoteLiveClock {
  timers: { run: () => void; live: boolean }[] = [];
  micro: (() => void)[] = [];

  later(run: () => void): () => void {
    const timer = { run, live: true };
    this.timers.push(timer);
    return () => {
      timer.live = false;
    };
  }

  soon(run: () => void): void {
    this.micro.push(run);
  }

  live(): { run: () => void; live: boolean }[] {
    this.timers = this.timers.filter((timer) => timer.live);
    return this.timers;
  }

  fire(index: number): void {
    const timer = this.live()[index];
    if (!timer) return;
    timer.live = false;
    timer.run();
  }

  fireAll(): void {
    while (this.live().length > 0) this.fire(0);
  }

  settle(): void {
    while (this.micro.length > 0) this.micro.shift()?.();
  }

  idle(): boolean {
    return this.live().length === 0 && this.micro.length === 0;
  }
}

function rng(seed: number): (bound: number) => number {
  let state = seed >>> 0;
  return (bound) => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    const unit = ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
    return Math.floor(unit * bound);
  };
}

const ALPHABET = ["a", "b", "c", "x", "y", "z", " ", "😀", "é"];

function pointAt(text: string, at: number): number {
  const point = text.codePointAt(at - 1);
  return at > 0 && at < text.length && point !== undefined && point > 0xffff ? at - 1 : at;
}

function typed(below: (bound: number) => number): string {
  let text = "";
  const count = 1 + below(3);
  for (let index = 0; index < count; index += 1) text += ALPHABET[below(ALPHABET.length)];
  return text;
}

function randomEdit(editor: FakeEditor, below: (bound: number) => number): void {
  const index = below(editor.blocks.length);
  const block = editor.blocks[index];
  const choice = below(10);
  if (choice < 5) {
    const at = pointAt(block.text, below(block.text.length + 1));
    const text = typed(below);
    editor.edit(index, (current) => ({ text: current.text.slice(0, at) + text + current.text.slice(at) }));
    return;
  }
  if (choice < 7) {
    const from = pointAt(block.text, below(block.text.length + 1));
    const to = pointAt(block.text, Math.min(block.text.length, from + 1 + below(3)));
    editor.edit(index, (current) => ({ text: current.text.slice(0, from) + current.text.slice(Math.max(from, to)) }));
    return;
  }
  if (choice < 8) {
    const at = pointAt(block.text, below(block.text.length + 1));
    const head: Block = { kind: block.kind, text: block.text.slice(0, at), source: null };
    const tail: Block = { kind: block.kind, text: block.text.slice(at), source: null };
    editor.blocks = [...editor.blocks.slice(0, index), head, tail, ...editor.blocks.slice(index + 1)];
    return;
  }
  if (choice < 9 && index > 0) {
    const previous = editor.blocks[index - 1];
    const joined: Block = { kind: previous.kind, text: previous.text + block.text, source: null };
    editor.blocks = [...editor.blocks.slice(0, index - 1), joined, ...editor.blocks.slice(index + 1)];
    return;
  }
  editor.edit(index, (current) => ({ kind: current.kind === "p" ? "li" : "p" }));
}

interface Peer {
  session: RemoteDocumentSession;
  editor: FakeEditor;
  binding: NoteLiveBinding;
  sends: number;
  errors: unknown[];
  id: string;
}

async function connect(
  channel: FakeChannel,
  clock: ManualClock,
  start = channel.text,
  offline?: (editor: FakeEditor) => void,
): Promise<Peer> {
  const session = new RemoteDocumentSession("note.md", start, { transport: channel.transport() });
  const editor = new FakeEditor(start);
  offline?.(editor);
  const errors: unknown[] = [];
  const binding = new NoteLiveBinding({ session, editor, clock, baseline: start, onError: (error) => errors.push(error) });
  const peer: Peer = { session, editor, binding, sends: 0, errors, id: "" };
  const applyLocal = session.applyLocal.bind(session);
  session.applyLocal = (edits, version) => {
    peer.sends += 1;
    applyLocal(edits, version);
  };
  binding.start();
  await session.open();
  peer.id = channel.opens.at(-1) ?? "";
  clock.settle();
  return peer;
}

function quiesce(channel: FakeChannel, clock: ManualClock, peers: readonly Peer[]): void {
  for (const peer of peers) {
    if (peer.editor.isComposing) {
      peer.editor.isComposing = false;
      peer.binding.compositionEnd();
    }
  }
  for (let round = 0; round < 200; round += 1) {
    clock.fireAll();
    clock.settle();
    channel.drain();
    clock.settle();
    const quiet = clock.idle() && channel.inbox.length === 0 && peers.every((peer) => channel.pendingFor(peer.id) === 0);
    if (quiet) return;
  }
  throw new Error("The peers never settled.");
}

const STARTS = [
  "# Lab notes\n* first bullet\n- second\nplain line",
  "",
  "alpha\nbeta\ngamma",
  "* one\n* two\n* three",
  "tail spaces  \nnext",
];

async function randomRun(seed: number): Promise<boolean> {
  const below = rng(seed);
  const channel = new FakeChannel(STARTS[seed % STARTS.length]);
  const clock = new ManualClock();
  const peers = [await connect(channel, clock), await connect(channel, clock), await connect(channel, clock)];
  const active = peers.slice(0, 2);
  const passive = peers[2];
  const stale = channel.text;
  const steps = 60 + below(100);
  const lateAt = seed % 2 === 0 ? below(steps) : -1;
  for (let step = 0; step < steps; step += 1) {
    if (step === lateAt) {
      const late = await connect(channel, clock, stale, (editor) => {
        const count = 1 + below(3);
        for (let index = 0; index < count; index += 1) randomEdit(editor, below);
      });
      peers.push(late);
      active.push(late);
    }
    const roll = below(100);
    if (roll < 34) {
      const peer = active[below(active.length)];
      randomEdit(peer.editor, below);
      peer.binding.localChanged();
    } else if (roll < 42) {
      const peer = active[below(active.length)];
      peer.editor.isComposing = !peer.editor.isComposing;
      if (!peer.editor.isComposing) peer.binding.compositionEnd();
    } else if (roll < 58) {
      clock.fire(below(Math.max(1, clock.live().length)));
    } else if (roll < 76) {
      channel.receiveOne();
    } else {
      channel.deliverOne(peers[below(peers.length)].id);
    }
    clock.settle();
  }
  quiesce(channel, clock, peers);
  const shown = rendered(parseBlocks(channel.text));
  let exact = true;
  for (const peer of peers) {
    expect(peer.errors, `seed ${seed}`).toEqual([]);
    expect(peer.session.synchronized, `seed ${seed}`).toBe(true);
    expect(peer.session.text(), `seed ${seed}`).toBe(channel.text);
    expect(rendered(peer.editor.blocks), `seed ${seed}`).toEqual(shown);
    if (peer.editor.serialize() !== channel.text) exact = false;
  }
  expect(passive.sends, `seed ${seed}`).toBe(0);
  expect(passive.editor.serialize(), `seed ${seed}`).toBe(channel.text);
  return exact;
}

function rendered(blocks: readonly Block[]): string[] {
  return blocks.map((block) => `${block.kind}:${block.text.trimEnd()}`);
}

async function setup(text: string, count = 2) {
  const channel = new FakeChannel(text);
  const clock = new ManualClock();
  const peers: Peer[] = [];
  for (let index = 0; index < count; index += 1) peers.push(await connect(channel, clock));
  return { channel, clock, peers };
}

describe("NoteLiveBinding", () => {
  it("converges for 1000 seeded random interleavings of typing, IME, late joins and delivery", async () => {
    let exact = 0;
    for (let seed = 1; seed <= 1000; seed += 1) if (await randomRun(seed)) exact += 1;
    expect(exact).toBe(1000);
  });

  it("turns local typing into one operation per send", async () => {
    const { channel, clock, peers } = await setup("hello\nworld");
    const [alice, bob] = peers;
    alice.editor.edit(0, (block) => ({ text: `${block.text}!` }));
    alice.binding.localChanged();
    alice.editor.edit(1, (block) => ({ text: `${block.text}?` }));
    alice.binding.localChanged();
    expect(channel.sent).toEqual([]);
    clock.fireAll();
    expect(channel.sent).toHaveLength(1);
    expect(TextOperation.fromWire(channel.sent[0].op).apply("hello\nworld")).toBe("hello!\nworld?");
    quiesce(channel, clock, peers);
    expect(bob.editor.serialize()).toBe("hello!\nworld?");
    expect(alice.sends).toBe(1);
    expect(bob.sends).toBe(0);
  });

  it("never sends the serializer's reformatting of blocks nobody touched", async () => {
    const { channel, clock, peers } = await setup("* one\n* two\n* three  ");
    const [alice] = peers;
    alice.editor.edit(1, (block) => ({ text: `${block.text}s` }));
    alice.binding.localChanged();
    clock.fireAll();
    expect(channel.sent.at(-1)?.op).toEqual([6, "- twos", -5, 10]);
    quiesce(channel, clock, peers);
    expect(channel.text).toBe("* one\n- twos\n* three  ");
  });

  it("rebases local edits past text the serializer would write differently", async () => {
    const channel = new FakeChannel("* one\n* two");
    const clock = new ManualClock();
    const session = new RemoteDocumentSession("note.md", "* one\n* two", { transport: channel.transport() });
    const editor = new FakeEditor("* one\n* two");
    editor.blocks = editor.blocks.map((block) => ({ ...block, source: null }));
    const binding = new NoteLiveBinding({ session, editor, clock, baseline: editor.serialize() });
    binding.start();
    await session.open();
    editor.edit(1, (block) => ({ text: `${block.text}!` }));
    binding.localChanged();
    clock.fireAll();
    channel.drain();
    clock.settle();
    expect(channel.text.startsWith("* one\n")).toBe(true);
    expect(channel.text.endsWith("two!")).toBe(true);
    expect(session.text()).toBe(channel.text);
  });

  it("applies remote edits without sending them back", async () => {
    const { channel, clock, peers } = await setup("one\ntwo");
    const [alice, bob] = peers;
    channel.remote(new TextOperation().retain(3).insert(" more").retain(4));
    channel.deliverOne(alice.id);
    channel.deliverOne(bob.id);
    clock.settle();
    expect(alice.editor.serialize()).toBe("one more\ntwo");
    expect(bob.editor.serialize()).toBe("one more\ntwo");
    clock.fireAll();
    expect(alice.sends + bob.sends).toBe(0);
    expect(channel.sent).toEqual([]);
  });

  it("keeps local text the serializer cannot round trip when a collaborator edits elsewhere", async () => {
    const { channel, clock, peers } = await setup("first\nsecond");
    const [alice, bob] = peers;
    alice.editor.edit(0, (block) => ({ text: `${block.text} ` }));
    alice.binding.localChanged();
    clock.fireAll();
    quiesce(channel, clock, peers);
    expect(alice.editor.blocks[0].text).toBe("first ");
    bob.editor.edit(1, (block) => ({ text: `${block.text}!` }));
    bob.binding.localChanged();
    quiesce(channel, clock, peers);
    expect(alice.editor.blocks[0].text).toBe("first ");
    expect(alice.editor.serialize()).toBe("first \nsecond!");
    expect(channel.text).toBe("first \nsecond!");
  });

  it("holds local edits and remote updates while an input method is composing", async () => {
    const { channel, clock, peers } = await setup("ab\ncd");
    const [alice, bob] = peers;
    alice.editor.isComposing = true;
    alice.editor.edit(0, (block) => ({ text: `${block.text}n` }));
    alice.binding.localChanged();
    clock.fire(0);
    clock.fire(0);
    expect(channel.sent).toEqual([]);
    bob.editor.edit(1, (block) => ({ text: `X${block.text}` }));
    bob.binding.localChanged();
    clock.fire(1);
    channel.drain();
    clock.settle();
    clock.fire(0);
    alice.binding.compositionEnd();
    expect(alice.editor.shows).toBe(0);
    expect(alice.session.text()).toBe("ab\nXcd");
    alice.editor.edit(0, () => ({ text: "ab你" }));
    alice.editor.isComposing = false;
    alice.binding.compositionEnd();
    clock.settle();
    expect(channel.sent.at(-1)?.client).toBe(alice.id);
    quiesce(channel, clock, peers);
    expect(channel.text).toBe("ab你\nXcd");
    expect(alice.editor.serialize()).toBe("ab你\nXcd");
    expect(bob.editor.serialize()).toBe("ab你\nXcd");
  });

  it("replaces the document on a reset and keeps converging", async () => {
    const { channel, clock, peers } = await setup("old text");
    const [alice, bob] = peers;
    channel.reset("brand new\ntext");
    channel.drain();
    clock.settle();
    expect(alice.editor.serialize()).toBe("brand new\ntext");
    bob.editor.edit(1, () => ({ text: "text!" }));
    bob.binding.localChanged();
    quiesce(channel, clock, peers);
    expect(alice.editor.serialize()).toBe("brand new\ntext!");
  });

  it("drops edits the server refuses and shows the server text", async () => {
    const discarded = vi.fn();
    const channel = new FakeChannel("shared");
    const clock = new ManualClock();
    const session = new RemoteDocumentSession("note.md", "shared", {
      transport: channel.transport(),
      onDiscarded: discarded,
    });
    const editor = new FakeEditor("shared");
    const binding = new NoteLiveBinding({ session, editor, clock });
    binding.start();
    await session.open();
    const id = channel.opens.at(-1) ?? "";
    channel.refuseChanges = true;
    editor.edit(0, () => ({ text: "mine" }));
    binding.localChanged();
    clock.fireAll();
    channel.receiveOne();
    channel.deliverOne(id);
    clock.settle();
    channel.receiveOne();
    channel.deliverOne(id);
    clock.settle();
    expect(discarded).toHaveBeenCalledWith("refused");
    expect(editor.serialize()).toBe("shared");
  });

  it("sends edits made before binding and rebases them onto the shared text", async () => {
    const channel = new FakeChannel("intro\nshared by bob");
    const clock = new ManualClock();
    const session = new RemoteDocumentSession("note.md", "intro", { transport: channel.transport() });
    const editor = new FakeEditor("intro");
    editor.edit(0, () => ({ text: "intro, edited offline" }));
    const binding = new NoteLiveBinding({ session, editor, clock, baseline: "intro" });
    binding.start();
    await session.open();
    clock.settle();
    channel.drain();
    clock.settle();
    expect(channel.text).toBe("intro, edited offline\nshared by bob");
    expect(editor.serialize()).toBe(channel.text);
  });

  it("detaches with the remote text shown and reports what it could not send", async () => {
    const { channel, clock, peers } = await setup("draft");
    const [alice, bob] = peers;
    bob.editor.edit(0, () => ({ text: "draft by bob" }));
    bob.binding.localChanged();
    clock.fireAll();
    channel.drain();
    alice.editor.isComposing = true;
    clock.settle();
    expect(alice.editor.serialize()).toBe("draft");
    alice.editor.isComposing = false;
    alice.editor.edit(0, () => ({ text: "draft and alice" }));
    expect(alice.binding.detach()).toEqual({ unsent: false });
    expect(alice.session.text()).toBe("draft and alice by bob");
    expect(alice.editor.serialize()).toBe("draft and alice by bob");
    expect(alice.binding.active).toBe(false);
    expect(alice.binding.detach()).toEqual({ unsent: false });
    alice.binding.localChanged();
    alice.binding.compositionEnd();
    alice.binding.flush();
    alice.binding.resync();
    alice.binding.start();
    expect(clock.live()).toEqual([]);
  });

  it("reports unsent text when the session cannot take edits at detach", async () => {
    const channel = new FakeChannel("text");
    const clock = new ManualClock();
    let readOnly = false;
    const session = new RemoteDocumentSession("note.md", "text", { transport: channel.transport(), readOnly: () => readOnly });
    const editor = new FakeEditor("text");
    const binding = new NoteLiveBinding({ session, editor, clock });
    binding.start();
    await session.open();
    editor.edit(0, () => ({ text: "text plus" }));
    readOnly = true;
    expect(binding.detach()).toEqual({ unsent: true });
  });

  it("binds again after a detach and keeps converging", async () => {
    const { channel, clock, peers } = await setup("start");
    const [alice, bob] = peers;
    alice.binding.detach();
    alice.session.close();
    const again = await connect(channel, clock, channel.text);
    again.editor.edit(0, () => ({ text: "start again" }));
    again.binding.localChanged();
    quiesce(channel, clock, [bob, again]);
    expect(bob.editor.serialize()).toBe("start again");
  });

  it("keeps a read-only editor on the shared text and never sends", async () => {
    const channel = new FakeChannel("shared text");
    const clock = new ManualClock();
    const session = new RemoteDocumentSession("note.md", "shared", { transport: channel.transport(), readOnly: () => true });
    const editor = new FakeEditor("shared");
    editor.edit(0, () => ({ text: "local change" }));
    const sends = vi.spyOn(session, "applyLocal");
    const binding = new NoteLiveBinding({ session, editor, clock, baseline: "shared" });
    binding.start();
    expect(editor.serialize()).toBe("shared");
    await session.open();
    clock.settle();
    expect(editor.serialize()).toBe("shared text");
    editor.edit(0, () => ({ text: "typed anyway" }));
    binding.localChanged();
    clock.fireAll();
    binding.flush();
    expect(sends).not.toHaveBeenCalled();
    binding.resync();
    expect(editor.serialize()).toBe("shared text");
  });

  it("starts a read-only binding without changes when the editor already matches", () => {
    const session = new RemoteDocumentSession("note.md", "same", {
      transport: { open: async () => null, change: () => undefined, close: () => undefined },
      readOnly: () => true,
    });
    const editor = new FakeEditor("same");
    new NoteLiveBinding({ session, editor, clock: new ManualClock() }).start();
    expect(editor.shows).toBe(0);
  });

  it("sends accepted agent suggestions as ordinary local edits", async () => {
    const { channel, clock, peers } = await setup("claim one\nclaim two");
    const [alice, bob] = peers;
    alice.editor.edit(1, () => ({ text: "claim two, with a citation" }));
    alice.binding.localChanged();
    quiesce(channel, clock, peers);
    expect(bob.editor.serialize()).toBe("claim one\nclaim two, with a citation");
  });

  it("recovers from a send that fails by showing the shared text", async () => {
    const { clock, peers } = await setup("base");
    const [alice] = peers;
    alice.errors.length = 0;
    alice.session.applyLocal = () => {
      throw new Error("boom");
    };
    alice.editor.edit(0, () => ({ text: "base edited" }));
    alice.binding.localChanged();
    clock.fireAll();
    expect(alice.errors).toHaveLength(1);
    expect(alice.editor.serialize()).toBe("base");
  });

  it("falls back to a text diff when remote edits cannot be tracked", async () => {
    const { channel, clock, peers } = await setup("abc\ndef");
    const [alice, bob] = peers;
    alice.editor.isComposing = true;
    alice.editor.edit(0, () => ({ text: "abcz" }));
    bob.editor.edit(1, () => ({ text: "def!" }));
    bob.binding.localChanged();
    clock.fireAll();
    channel.drain();
    const internals = alice.binding as unknown as { remote: unknown; known: string };
    internals.known = "zz";
    channel.remote(new TextOperation().retain(8).insert("?"));
    channel.drain();
    clock.settle();
    alice.editor.isComposing = false;
    alice.binding.compositionEnd();
    quiesce(channel, clock, peers);
    expect(alice.errors).toEqual([]);
    expect(alice.editor.serialize()).toBe(channel.text);
    expect(channel.text).toBe("abcz\ndef!?");
  });

  it("uses the real timers by default", () => {
    vi.useFakeTimers();
    try {
      const run = vi.fn();
      const cancel = browserClock.later(run, LIVE_SEND_MS);
      vi.advanceTimersByTime(LIVE_SEND_MS);
      expect(run).toHaveBeenCalledTimes(1);
      cancel();
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs soon work as a microtask", async () => {
    const run = vi.fn();
    browserClock.soon(run);
    expect(run).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
