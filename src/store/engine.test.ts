import { describe, expect, it } from "vitest";
import { installPhaseLabel } from "./engine";

describe("installPhaseLabel", () => {
  it("shows the download percentage when the total size is known", () => {
    expect(installPhaseLabel("download", 42)).toBe("Downloading… 42%");
  });

  it("shows a plain downloading label when the size is unknown", () => {
    expect(installPhaseLabel("download", null)).toBe("Downloading…");
  });

  it("labels the extract phase", () => {
    expect(installPhaseLabel("extract", null)).toBe("Unpacking…");
  });

  it("labels the packages phase", () => {
    expect(installPhaseLabel("packages", null)).toBe("Adding packages…");
  });

  it("falls back to a generic label when idle", () => {
    expect(installPhaseLabel(null, null)).toBe("Installing…");
  });
});
