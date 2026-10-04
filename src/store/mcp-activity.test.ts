import { beforeEach, describe, expect, it, vi } from "vitest";
import errors from "@/i18n/locales/en/errors.json" with { type: "json" };
import {
  formatMcpArgs,
  sanitizeMcpArgs,
  summarizeMcpError,
  summarizeMcpResult,
  useMcpActivityStore,
} from "@/store/mcp-activity";

const notFound = `@oleafly/error:${JSON.stringify({ code: "project.not_found", params: {}, detail: null })}`;

describe("MCP activity argument retention", () => {
  beforeEach(() => {
    useMcpActivityStore.setState({ logs: [], unread: 0 });
  });

  it("never retains file bodies or other bulk payloads", () => {
    const content = "secret manuscript ".repeat(100_000);
    const args = sanitizeMcpArgs({
      path: "main.tex",
      content,
      nested: { token: "must not be retained" },
    });

    expect(args).toEqual({
      path: "main.tex",
      content: `[omitted ${content.length} chars]`,
      nested: "[object]",
    });
    expect(JSON.stringify(args)).not.toContain("secret manuscript");
  });

  it("stores only the bounded summary for a running call", () => {
    const content = "x".repeat(16 * 1024 * 1024);
    useMcpActivityStore.getState().beginCall("write_file", {
      path: "main.tex",
      content,
    });

    const retained = useMcpActivityStore.getState().logs[0].args;
    expect(retained).toEqual({
      path: "main.tex",
      content: `[omitted ${content.length} chars]`,
    });
    expect(formatMcpArgs(retained).length).toBeLessThanOrEqual(120);
  });
});

describe("MCP argument summaries", () => {
  it("keeps short scalar values and marks bulky or nested ones", () => {
    expect(
      sanitizeMcpArgs({
        line: 4,
        force: true,
        missing: null,
        paths: ["a.tex", "b.tex"],
        query: "q".repeat(200),
        sourceText: "[omitted 12 chars]",
      }),
    ).toEqual({
      line: 4,
      force: true,
      missing: null,
      paths: "[2 items]",
      query: `${"q".repeat(159)}…`,
      sourceText: "[omitted 12 chars]",
    });
  });

  it("re-marks a value that only looks like an omission marker", () => {
    expect(sanitizeMcpArgs({ content: "[omitted lots chars]" })).toEqual({ content: "[omitted 20 chars]" });
  });

  it("keeps the first 16 arguments and flags the rest as truncated", () => {
    const args = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`k${index}`, index]));

    const sanitized = sanitizeMcpArgs(args);

    expect(Object.keys(sanitized)).toHaveLength(17);
    expect(sanitized._truncated).toBe(true);
    expect(sanitized).not.toHaveProperty("k16");
  });

  it("formats empty arguments as nothing and long ones with an ellipsis", () => {
    expect(formatMcpArgs({})).toBe("");
    const long = formatMcpArgs({ a: "x".repeat(100), b: "y".repeat(100) });
    expect(long).toHaveLength(118);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("MCP call log", () => {
  beforeEach(() => {
    useMcpActivityStore.setState({ logs: [], unread: 0, serverRunning: false });
  });

  it("records the outcome and duration of a finished call once", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const id = useMcpActivityStore.getState().beginCall("compile", {});
    vi.setSystemTime(1_250);

    useMcpActivityStore.getState().endCall(id, { ok: false, summary: "failed" });
    useMcpActivityStore.getState().endCall(id, { ok: true, summary: "again" });
    useMcpActivityStore.getState().endCall(9_999_999, { ok: true });
    vi.useRealTimers();

    expect(useMcpActivityStore.getState().logs[0]).toMatchObject({
      name: "compile",
      status: "error",
      durationMs: 250,
      summary: "failed",
    });
    expect(useMcpActivityStore.getState().unread).toBe(1);
  });

  it("keeps the 200 most recent calls", () => {
    for (let index = 0; index < 205; index += 1) useMcpActivityStore.getState().beginCall(`tool${index}`, {});

    const logs = useMcpActivityStore.getState().logs;
    expect(logs).toHaveLength(200);
    expect(logs[0].name).toBe("tool204");
  });

  it("clears unread counts and logs", () => {
    const id = useMcpActivityStore.getState().beginCall("read_file", { path: "main.tex" });
    useMcpActivityStore.getState().endCall(id, { ok: true });
    useMcpActivityStore.getState().setServerRunning(true);

    useMcpActivityStore.getState().clearUnread();
    expect(useMcpActivityStore.getState()).toMatchObject({ unread: 0, serverRunning: true });
    expect(useMcpActivityStore.getState().logs).toHaveLength(1);

    useMcpActivityStore.getState().clearLogs();
    expect(useMcpActivityStore.getState().logs).toEqual([]);
  });
});

describe("MCP result summaries", () => {
  it("summarizes a missing result by its outcome", () => {
    expect(summarizeMcpResult(undefined)).toBe("ok");
    expect(summarizeMcpResult(null, true)).toBe("error");
  });

  it("shortens long text results", () => {
    expect(summarizeMcpResult("done")).toBe("done");
    const long = summarizeMcpResult("z".repeat(300));
    expect(long).toHaveLength(158);
    expect(long.endsWith("…")).toBe(true);
  });

  it("translates coded errors in text results", () => {
    expect(summarizeMcpResult(notFound, true)).toBe(errors.project.not_found);
    expect(summarizeMcpResult(JSON.stringify({ error: notFound }), true)).toBe(errors.project.not_found);
    expect(summarizeMcpResult(JSON.stringify({ error: "plain" }), true)).toBe(JSON.stringify({ error: "plain" }));
    expect(summarizeMcpResult("not json", true)).toBe("not json");
    expect(summarizeMcpResult(notFound)).toBe(notFound);
  });

  it("summarizes object results by their error or their JSON", () => {
    expect(summarizeMcpResult({ error: "file missing" }, true)).toBe("file missing");
    expect(summarizeMcpResult({ error: notFound }, true)).toBe(errors.project.not_found);
    expect(summarizeMcpResult({ pages: 3 })).toBe('{"pages":3}');
    expect(summarizeMcpResult({ text: "w".repeat(300) })).toHaveLength(158);
  });

  it("falls back to the outcome when an object cannot be serialized", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(summarizeMcpResult(cyclic)).toBe("ok");
    expect(summarizeMcpResult(cyclic, true)).toBe("error");
  });

  it("prints other values as text", () => {
    expect(summarizeMcpResult(42)).toBe("42");
    expect(summarizeMcpResult(false)).toBe("false");
  });

  it("translates coded thrown errors and prints the rest", () => {
    expect(summarizeMcpError(notFound)).toBe(errors.project.not_found);
    expect(summarizeMcpError(new Error("socket closed"))).toBe("Error: socket closed");
  });
});
