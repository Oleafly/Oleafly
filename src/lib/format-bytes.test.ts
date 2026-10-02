import { afterEach, describe, expect, it } from "vitest";
import { applyLocale } from "@/i18n";
import { formatBytes } from "./format-bytes";

const KIB = 1024;
const MIB = KIB * KIB;
const GIB = MIB * KIB;

describe("formatBytes", () => {
  afterEach(async () => {
    await applyLocale("en");
  });

  it("steps through the units in powers of 1024", () => {
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(KIB)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(2400)).toBe("2.34 KB");
    expect(formatBytes(150 * KIB + 512)).toBe("150.5 KB");
    expect(formatBytes(64 * MIB)).toBe("64 MB");
    expect(formatBytes(3 * GIB)).toBe("3 GB");
    expect(formatBytes(2 * GIB * KIB)).toBe("2 TB");
    expect(formatBytes(5000 * GIB * KIB)).toBe("5,000 TB");
  });

  it("shows zero for empty, negative and unknown sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(0.5)).toBe("1 B");
  });

  it("uses the unit names of the active locale", async () => {
    await applyLocale("fr");
    expect(formatBytes(900)).toBe("900 o");
    await applyLocale("uk");
    expect(formatBytes(1536)).toBe("1,5 КБ");
    expect(formatBytes(3 * GIB)).toBe("3 ГБ");
  });
});
