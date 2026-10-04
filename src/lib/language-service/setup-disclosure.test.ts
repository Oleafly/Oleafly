import languageServerManifest from "../../../scripts/language-servers/manifest.json" with { type: "json" };
import { describe, expect, it } from "vitest";
import {
  getLanguageServiceSetupDisclosure,
  parseLanguageServiceSetupDisclosure,
} from "./setup-disclosure";

describe("language-service setup disclosure", () => {
  it("derives the TexLab consent details from the packaged manifest", () => {
    expect(getLanguageServiceSetupDisclosure("texlab")).toEqual({
      kind: "texlab",
      displayName: "TexLab",
      version: "5.26.0",
      purpose:
        "Provide project-aware LaTeX diagnostics, navigation, completion, and structure analysis in Oleafly.",
      license: {
        spdx: "GPL-3.0-only",
        url: "https://raw.githubusercontent.com/latex-lsp/texlab/v5.26.0/LICENSE",
      },
      sourceUrl:
        "https://github.com/latex-lsp/texlab/tree/v5.26.0",
      destination:
        "App-local data / language-servers/texlab/5.26.0/<platform>/texlab[.exe]",
      checksumVerification: true,
    });
  });

  it("fails closed for a non-consent server or incomplete checksum metadata", () => {
    expect(() =>
      parseLanguageServiceSetupDisclosure(
        languageServerManifest,
        "tinymist",
      ),
    ).toThrow(/does not permit a consent download/u);

    const malformed = structuredClone(languageServerManifest);
    malformed.servers.texlab.targets[
      "aarch64-apple-darwin"
    ].binarySha256 = "";
    expect(() =>
      parseLanguageServiceSetupDisclosure(
        malformed,
        "texlab",
      ),
    ).toThrow(/binarySha256/u);
  });
});

describe("language-service setup disclosure validation", () => {
  const target = "aarch64-apple-darwin";

  function broken(
    mutate: (manifest: typeof languageServerManifest) => void,
  ): typeof languageServerManifest {
    const manifest = structuredClone(languageServerManifest);
    mutate(manifest);
    return manifest;
  }

  it.each([
    [
      "an unsupported schema",
      broken((manifest) => {
        manifest.schemaVersion = 2;
      }),
      /setup manifest schema is invalid/u,
    ],
    [
      "an empty target list",
      broken((manifest) => {
        manifest.supportedTargets = [];
      }),
      /setup manifest schema is invalid/u,
    ],
    [
      "a missing server entry",
      broken((manifest) => {
        Reflect.deleteProperty(manifest.servers.texlab, "license");
      }),
      /setup metadata for texlab is missing/u,
    ],
    [
      "a blank display name",
      broken((manifest) => {
        manifest.servers.texlab.displayName = " ";
      }),
      /field texlab.displayName is invalid/u,
    ],
    [
      "a license URL that is not a URL",
      broken((manifest) => {
        manifest.servers.texlab.license.licenseUrl = "not a url";
      }),
      /field texlab.license.licenseUrl is not a URL/u,
    ],
    [
      "a source URL without HTTPS",
      broken((manifest) => {
        manifest.servers.texlab.license.sourceUrl =
          "http://github.com/latex-lsp/texlab/tree/v5.26.0";
      }),
      /field texlab.license.sourceUrl must use HTTPS/u,
    ],
    [
      "a source URL that is not pinned to the tag",
      broken((manifest) => {
        manifest.servers.texlab.license.sourceUrl =
          "https://github.com/latex-lsp/texlab/tree/master";
      }),
      /not pinned to v5.26.0/u,
    ],
    [
      "a missing target artifact",
      broken((manifest) => {
        Reflect.deleteProperty(manifest.servers.texlab.targets, target);
      }),
      new RegExp(`artifact for texlab/${target} is missing`, "u"),
    ],
    [
      "a zero archive size",
      broken((manifest) => {
        manifest.servers.texlab.targets[target].archiveSize = 0;
      }),
      /archiveSize must be a positive integer/u,
    ],
  ])("fails closed on %s", (_label, manifest, message) => {
    expect(() =>
      parseLanguageServiceSetupDisclosure(manifest, "texlab"),
    ).toThrow(message);
  });
});

