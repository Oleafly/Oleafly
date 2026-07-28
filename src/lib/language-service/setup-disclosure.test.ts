import languageServerManifest from "../../../scripts/language-servers/manifest.json";
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
