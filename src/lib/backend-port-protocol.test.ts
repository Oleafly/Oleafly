import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BACKEND_CAPABILITIES,
  PROTOCOL_VERSION,
} from "@oleafly/backend-port";

const rustSource = readFileSync(
  fileURLToPath(new URL("../../src-tauri/src/protocol.rs", import.meta.url)),
  "utf8",
);

describe("backend-port protocol contract", () => {
  it("declares a positive integer protocol version", () => {
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
    expect(PROTOCOL_VERSION).toBeGreaterThan(0);
  });

  it("declares a non-empty, sorted, duplicate-free capability list", () => {
    expect(BACKEND_CAPABILITIES.length).toBeGreaterThan(0);
    const sorted = [...BACKEND_CAPABILITIES].sort();
    expect([...BACKEND_CAPABILITIES]).toEqual(sorted);
    expect(new Set(BACKEND_CAPABILITIES).size).toBe(BACKEND_CAPABILITIES.length);
  });

  it("requires a backend that implements Checkpoints", () => {
    expect(BACKEND_CAPABILITIES).toContain("checkpoints");
  });

  it("matches the Rust protocol version, so drift fails the suite", () => {
    const match = rustSource.match(/PROTOCOL_VERSION:\s*u32\s*=\s*(\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBe(PROTOCOL_VERSION);
  });

  it("matches the Rust capability list exactly", () => {
    const match = rustSource.match(/CAPABILITIES[^=]*=\s*\[([^\]]*)\]/);
    expect(match).not.toBeNull();
    const rustCapabilities = [...(match?.[1] ?? "").matchAll(/"([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(rustCapabilities).toEqual([...BACKEND_CAPABILITIES]);
  });
});
