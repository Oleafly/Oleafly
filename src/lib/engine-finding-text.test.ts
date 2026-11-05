import { describe, expect, it } from "vitest";
import {
  classifyCompileFailure,
  IMPORT_COMPAT_CATALOG,
  importCompatFinding,
  type ImportCompatFindingId,
} from "@oleafly/latex";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { engineFindingDetail, engineFindingTitle } from "./engine-finding-text";

const texts = enShell.enginePicker.findings as Record<string, { title: string; detail: string }>;

describe("engine finding text", () => {
  it("has a shell string for every catalog finding", () => {
    for (const id of Object.keys(IMPORT_COMPAT_CATALOG)) {
      expect(texts[id]?.title, id).toBeTruthy();
      expect(texts[id]?.detail, id).toBeTruthy();
    }
  });

  it("reads catalog findings from the locale", () => {
    for (const id of Object.keys(IMPORT_COMPAT_CATALOG) as ImportCompatFindingId[]) {
      const finding = importCompatFinding(id);
      expect(engineFindingTitle(finding)).toBe(texts[id].title);
      expect(engineFindingDetail(finding)).toBe(texts[id].detail);
    }
  });

  it("keeps competitor names out of the new strings", () => {
    expect(JSON.stringify(texts)).not.toMatch(/overleaf/i);
  });

  it("rebuilds the appended sentences from the finding's params", () => {
    const [eps] = classifyCompileFailure('error: pdf: image inclusion failed for "plots/curve.eps"');
    expect(engineFindingDetail(eps)).toBe(
      `${texts["eps-image"].detail} ${enShell.enginePicker.findingNotes.epsFile.replace("{{file}}", "plots/curve.eps")}`,
    );
    const [missing] = classifyCompileFailure("! LaTeX Error: File `siunitx.sty' not found.");
    expect(engineFindingDetail(missing)).toBe(
      `${texts["missing-sty-on-bundled-engine"].detail} ${enShell.enginePicker.findingNotes.missingFiles.replace("{{files}}", "siunitx.sty")}`,
    );
    const [mirror] = classifyCompileFailure(
      "error: failed to download tex-bundles file\nunexpected http response code 429 Too Many Requests",
    );
    expect(mirror.id).toBe("bundle-fetch-failed");
    expect(engineFindingDetail(mirror)).toBe(
      `${texts["bundle-fetch-failed"].detail} ${enShell.enginePicker.findingNotes.mirrorStatus.replace("{{status}}", "429")}`,
    );
  });

  it("shows text that isn't from the catalog as it came", () => {
    const custom = { id: "minted", level: "blocker" as const, title: "minted needs a shell", detail: "why" };
    expect(engineFindingTitle(custom)).toBe("minted needs a shell");
    expect(engineFindingDetail(custom)).toBe("why");
    const unknown = { id: "new-gap", level: "info" as const, title: "New", detail: "Detail" };
    expect(engineFindingTitle(unknown)).toBe("New");
    expect(engineFindingDetail(unknown)).toBe("Detail");
  });
});
