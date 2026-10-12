import type { CollabDocMessage, CollabDocOpened, CollabTextOperation } from "@/lib/tauri";
import { TextOperation } from "../ot";
import type { RemoteSessionTransport } from "../remote-session";

interface Client {
  id: string;
  onMessage: (message: CollabDocMessage) => void;
  outbox: CollabDocMessage[];
  open: boolean;
}

interface Change {
  client: string;
  rev: number;
  op: CollabTextOperation;
}

export class FakeChannel {
  text: string;
  rev = 0;
  firstRev = 0;
  refuseChanges = false;
  readonly history: TextOperation[] = [];
  readonly inbox: Change[] = [];
  readonly clients = new Map<string, Client>();
  readonly opens: string[] = [];
  readonly closes: string[] = [];
  readonly sent: Change[] = [];
  private next = 0;

  constructor(text: string) {
    this.text = text;
  }

  transport(): RemoteSessionTransport {
    return {
      open: async (_path, onMessage): Promise<CollabDocOpened | null> => {
        const id = `file-${this.next++}`;
        this.clients.set(id, { id, onMessage, outbox: [], open: true });
        this.opens.push(id);
        return { file_id: id, rev: this.rev, text: this.text };
      },
      change: (fileId, rev, op) => {
        const change = { client: fileId, rev, op };
        this.sent.push(change);
        this.inbox.push(change);
      },
      close: (fileId) => {
        this.closes.push(fileId);
        const client = this.clients.get(fileId);
        if (client) client.open = false;
      },
    };
  }

  remote(op: TextOperation): void {
    this.text = op.apply(this.text);
    this.record(op);
    for (const client of this.clients.values()) {
      if (client.open) {
        client.outbox.push({ kind: "remote", rev: this.rev, op: op.toWire(), length: this.text.length });
      }
    }
  }

  reset(text: string): void {
    this.text = text;
    this.rev += 1;
    this.firstRev = this.rev;
    this.history.length = 0;
    for (const client of this.clients.values()) {
      if (client.open) client.outbox.push({ kind: "reset", rev: this.rev, text });
    }
  }

  receiveOne(): boolean {
    const change = this.inbox.shift();
    if (!change) return false;
    const client = this.clients.get(change.client);
    if (!client?.open) return true;
    if (this.refuseChanges || change.rev < this.firstRev) {
      client.outbox.push({ kind: "reset", rev: this.rev, text: this.text });
      return true;
    }
    let operation = TextOperation.fromWire(change.op);
    for (const concurrent of this.history.slice(change.rev - this.firstRev)) {
      operation = TextOperation.transform(operation, concurrent)[0];
    }
    this.text = operation.apply(this.text);
    this.record(operation);
    for (const other of this.clients.values()) {
      if (!other.open) continue;
      if (other === client) other.outbox.push({ kind: "ack", rev: this.rev, length: this.text.length });
      else other.outbox.push({ kind: "remote", rev: this.rev, op: operation.toWire(), length: this.text.length });
    }
    return true;
  }

  deliverOne(id: string): boolean {
    const client = this.clients.get(id);
    const message = client?.outbox.shift();
    if (!client || !message) return false;
    if (client.open) client.onMessage(message);
    return true;
  }

  pendingFor(id: string): number {
    return this.clients.get(id)?.outbox.length ?? 0;
  }

  drain(): void {
    let progressed = true;
    while (progressed) {
      progressed = this.receiveOne();
      for (const id of this.clients.keys()) {
        while (this.deliverOne(id)) progressed = true;
      }
    }
  }

  private record(operation: TextOperation): void {
    this.history.push(operation);
    this.rev += 1;
  }
}
