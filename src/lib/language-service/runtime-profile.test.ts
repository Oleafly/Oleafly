import { describe, expect, it } from "vitest";
import {
  getLanguageServiceRuntimeProfile,
  parseLanguageServiceRuntimeProfile,
} from "./runtime-profile";

function manifestWithLsp(lsp: Record<string, unknown>) {
  return {
    schemaVersion: 1,
    servers: {
      texlab: {
        version: "5.26.0",
        lsp,
      },
    },
  };
}

describe("language-service runtime profile", () => {
  it("loads the exact pinned no-build/no-export handshakes", () => {
    expect(getLanguageServiceRuntimeProfile("texlab")).toEqual({
      kind: "texlab",
      version: "5.26.0",
      args: ["run"],
      initializationOptions: {},
      didChangeConfiguration: {
        settings: {
          texlab: {
            build: {
              onSave: false,
            },
          },
        },
      },
    });
    expect(getLanguageServiceRuntimeProfile("tinymist")).toEqual({
      kind: "tinymist",
      version: "0.15.2",
      args: ["lsp"],
      initializationOptions: {
        exportPdf: "never",
        compileStatus: "disable",
      },
      didChangeConfiguration: null,
    });
  });

  it("fails closed on incomplete, extended, or non-JSON profiles", () => {
    const validLsp = {
      args: ["run"],
      helpArgs: ["run", "--help"],
      initializationOptions: {},
      didChangeConfiguration: {
        settings: {},
      },
    };
    expect(() =>
      parseLanguageServiceRuntimeProfile(
        manifestWithLsp({
          ...validLsp,
          extra: true,
        }),
        "texlab",
      ),
    ).toThrow("invalid");
    expect(() =>
      parseLanguageServiceRuntimeProfile(
        manifestWithLsp({
          ...validLsp,
          didChangeConfiguration: {},
        }),
        "texlab",
      ),
    ).toThrow("invalid");
    expect(() =>
      parseLanguageServiceRuntimeProfile(
        manifestWithLsp({
          ...validLsp,
          initializationOptions: {
            invalid: undefined,
          },
        }),
        "texlab",
      ),
    ).toThrow("invalid");
  });
});
