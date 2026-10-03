import { describe, expect, it } from "vitest";
import {
  createInitializeParams,
  negotiateServerCapabilities,
} from "./protocol";

const offered = ["utf-8", "utf-16", "utf-32"] as const;

describe("textDocumentSync negotiation", () => {
  it.each([
    [
      0,
      {
        openClose: false,
        change: "none",
        save: { enabled: false, includeText: false },
      },
    ],
    [
      1,
      {
        openClose: true,
        change: "full",
        save: { enabled: false, includeText: false },
      },
    ],
    [
      2,
      {
        openClose: true,
        change: "incremental",
        save: { enabled: false, includeText: false },
      },
    ],
  ])("parses numeric synchronization kind %s", (value, expected) => {
    expect(
      negotiateServerCapabilities(
        { capabilities: { textDocumentSync: value } },
        [...offered],
      ).textDocumentSync,
    ).toEqual(expected);
  });

  it("parses open/close and save options without inventing defaults", () => {
    expect(
      negotiateServerCapabilities(
        {
          capabilities: {
            textDocumentSync: {
              openClose: true,
              change: 2,
              save: { includeText: true },
            },
          },
        },
        [...offered],
      ).textDocumentSync,
    ).toEqual({
      openClose: true,
      change: "incremental",
      save: { enabled: true, includeText: true },
    });
  });

  it("fails closed on malformed synchronization capabilities", () => {
    expect(() =>
      negotiateServerCapabilities(
        { capabilities: { textDocumentSync: 3 } },
        [...offered],
      ),
    ).toThrow("invalid textDocumentSync");
    expect(() =>
      negotiateServerCapabilities(
        {
          capabilities: {
            textDocumentSync: { change: "incremental" },
          },
        },
        [...offered],
      ),
    ).toThrow("invalid textDocumentSync");
  });
});

const TINYMIST_CAPABILITIES = {
  positionEncoding: "utf-16",
  colorProvider: true,
  completionProvider: {
    triggerCharacters: ["#", "(", "<", ",", ".", ":", "/", "\"", "@"],
  },
  documentFormattingProvider: true,
  documentLinkProvider: {},
  documentRangeFormattingProvider: true,
  executeCommandProvider: {
    commands: ["tinymist.pinMain", "tinymist.focusMain"],
  },
  inlayHintProvider: true,
  renameProvider: { prepareProvider: true },
  signatureHelpProvider: { triggerCharacters: ["(", ",", ":"] },
  textDocumentSync: { change: 2, openClose: true, save: true },
};

describe("Tinymist capability negotiation", () => {
  it("reads the editing features Tinymist 0.15.8 advertises", () => {
    const negotiated = negotiateServerCapabilities(
      { capabilities: TINYMIST_CAPABILITIES },
      [...offered],
    );
    expect(negotiated.completionTriggerCharacters).toEqual(
      TINYMIST_CAPABILITIES.completionProvider.triggerCharacters,
    );
    expect(negotiated.signatureHelp).toEqual({
      enabled: true,
      triggerCharacters: ["(", ",", ":"],
      retriggerCharacters: [],
    });
    expect(negotiated.inlayHints).toBe(true);
    expect(negotiated.documentLinks).toBe(true);
    expect(negotiated.documentColors).toBe(true);
    expect(negotiated.formatting).toBe(true);
    expect(negotiated.rangeFormatting).toBe(true);
    expect(negotiated.rename).toEqual({ enabled: true, prepare: true });
    expect(negotiated.executeCommands).toEqual([
      "tinymist.pinMain",
      "tinymist.focusMain",
    ]);
  });

  it("treats a missing or false provider as unsupported", () => {
    const negotiated = negotiateServerCapabilities(
      {
        capabilities: {
          renameProvider: true,
          colorProvider: false,
          executeCommandProvider: { commands: ["ok", 3] },
        },
      },
      [...offered],
    );
    expect(negotiated.rename).toEqual({ enabled: true, prepare: false });
    expect(negotiated.documentColors).toBe(false);
    expect(negotiated.signatureHelp.enabled).toBe(false);
    expect(negotiated.inlayHints).toBe(false);
    expect(negotiated.formatting).toBe(false);
    expect(negotiated.executeCommands).toEqual(["ok"]);
    expect(negotiated.completionTriggerCharacters).toEqual([]);
  });
});

describe("initialize request", () => {
  it("offers the editing features the editor renders", () => {
    const params = createInitializeParams({ rootUri: "file:///p" }, ["utf-16"]);
    expect(params.capabilities.textDocument).toMatchObject({
      signatureHelp: {
        contextSupport: true,
        signatureInformation: {
          activeParameterSupport: true,
          parameterInformation: { labelOffsetSupport: true },
        },
      },
      inlayHint: {},
      documentLink: {},
      colorProvider: {},
      formatting: {},
      rangeFormatting: {},
      rename: { prepareSupport: true },
    });
    expect(params.capabilities.workspace).toMatchObject({
      executeCommand: {},
      didChangeConfiguration: {},
      workspaceEdit: {
        documentChanges: true,
        resourceOperations: ["rename"],
      },
    });
  });
});
