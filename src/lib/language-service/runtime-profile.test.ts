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
      version: "0.15.8",
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

describe("language-service runtime profile manifest checks", () => {
  const validLsp = {
    args: ["run"],
    helpArgs: [],
    initializationOptions: null,
    didChangeConfiguration: null,
  };

  it("accepts profiles without initialization options or configuration", () => {
    expect(
      parseLanguageServiceRuntimeProfile(manifestWithLsp(validLsp), "texlab"),
    ).toEqual({
      kind: "texlab",
      version: "5.26.0",
      args: ["run"],
      initializationOptions: null,
      didChangeConfiguration: null,
    });
  });

  it.each([
    [null],
    [{ schemaVersion: 2, servers: {} }],
    [{ schemaVersion: 1, servers: [] }],
  ])("rejects the manifest %o", (manifest) => {
    expect(() =>
      parseLanguageServiceRuntimeProfile(manifest, "texlab"),
    ).toThrow("Language-server manifest schema is invalid");
  });

  it("rejects configuration settings that are not a JSON object", () => {
    expect(() =>
      parseLanguageServiceRuntimeProfile(
        manifestWithLsp({
          ...validLsp,
          didChangeConfiguration: { settings: "texlab" },
        }),
        "texlab",
      ),
    ).toThrow("Language-server configuration settings for texlab are invalid");
  });
});

