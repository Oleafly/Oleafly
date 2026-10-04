import { describe, expect, it, vi } from "vitest";
import type { LanguageServiceTransportEvent } from "@/lib/language-service";
import { FakeTinymistTransport } from "./fake-tinymist-transport";

async function started() {
  const transport = new FakeTinymistTransport();
  const events: LanguageServiceTransportEvent[] = [];
  const session = await transport.start(
    { kind: "tinymist", projectId: "project-a" },
    (event) => events.push(event),
  );
  return { transport, session, events };
}

describe("FakeTinymistTransport", () => {
  it("reports its session status and stops only the current session", async () => {
    const { transport, session } = await started();
    expect(transport.status()).toEqual({ state: "running", session });
    await expect(transport.refreshStatus()).resolves.toEqual({
      state: "running",
      session,
    });

    await transport.stop({ ...session, session: "someone-else" });
    expect(transport.status().state).toBe("running");
    await transport.stop(session);
    expect(transport.status()).toEqual({ state: "stopped", session: null });
  });

  it("records notifications without answering and answers requests like Tinymist", async () => {
    const { transport, session, events } = await started();
    transport.handlers.set("textDocument/hover", () => ({ contents: "hi" }));

    await transport.send(session, { jsonrpc: "2.0", method: "initialized" });
    await transport.send(session, { jsonrpc: "2.0", id: 1, result: null });
    await transport.send(session, {
      jsonrpc: "2.0",
      id: 2,
      method: "textDocument/hover",
      params: { position: { line: 0, character: 0 } },
    });
    await transport.send(session, {
      jsonrpc: "2.0",
      id: 3,
      method: "workspace/symbol",
      params: { query: "" },
    });
    await transport.send(session, {
      jsonrpc: "2.0",
      id: 4,
      method: "shutdown",
    });
    await vi.waitFor(() => expect(events).toHaveLength(3));

    expect(transport.methods("initialized")).toEqual([
      { method: "initialized", params: undefined },
    ]);
    expect(transport.messages).toHaveLength(4);
    expect(
      events.map((event) =>
        event.type === "message" ? event.message : event.type,
      ),
    ).toEqual([
      { jsonrpc: "2.0", id: 2, result: { contents: "hi" } },
      { jsonrpc: "2.0", id: 3, result: [] },
      { jsonrpc: "2.0", id: 4, result: null },
    ]);
  });
});
