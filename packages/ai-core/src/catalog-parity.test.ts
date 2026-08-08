import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROVIDERS } from "./providers";

const RUST = readFileSync(
  join(process.cwd(), "crates/oleafly-agent/src/provider.rs"),
  "utf8",
);

function rustCatalog(): { id: string; base: string | null; model: string }[] {
  const body = RUST.slice(RUST.indexOf("pub const CATALOG"), RUST.indexOf("pub fn catalog_entry"));
  return [...body.matchAll(/id:\s*"([^"]+)",\s*base_url:\s*(None|Some\("([^"]+)"\)),\s*default_model:\s*"([^"]+)"/g)].map(
    (m) => ({ id: m[1], base: m[3] ?? null, model: m[4] }),
  );
}

describe("provider catalog parity", () => {
  const rust = rustCatalog();

  it("parses the Rust catalog", () => {
    expect(rust.length).toBeGreaterThan(5);
  });

  it("lists the same providers in the same order", () => {
    expect(rust.map((r) => r.id)).toEqual(PROVIDERS.map((p) => p.id));
  });

  it("agrees on every base URL", () => {
    for (const entry of rust) {
      const ts = PROVIDERS.find((p) => p.id === entry.id);
      expect(entry.base ?? null, `${entry.id} base URL`).toBe(ts?.baseURL ?? null);
    }
  });

  it("agrees on every default model", () => {
    for (const entry of rust) {
      const ts = PROVIDERS.find((p) => p.id === entry.id);
      expect(entry.model, `${entry.id} default model`).toBe(ts?.models[0]?.id);
    }
  });
});
