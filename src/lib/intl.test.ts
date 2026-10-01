import { afterEach, describe, expect, it } from "vitest";
import { applyLocale } from "@/i18n";
import {
  formatCompactNumber,
  formatList,
  formatNameList,
  formatNumber,
  formatRelativeTime,
} from "./intl";

describe("intl helpers", () => {
  afterEach(async () => {
    await applyLocale("en");
  });

  it("formats with the active locale", async () => {
    expect(formatNumber(1234567)).toBe("1,234,567");
    expect(formatCompactNumber(1500)).toBe("1.5K");
    expect(formatList(["a", "b", "c"])).toBe("a, b, and c");
    expect(formatRelativeTime(-3, "day")).toBe("3 days ago");
    await applyLocale("zh-Hans");
    expect(formatNumber(1234567)).toBe("1,234,567");
    expect(formatList(["甲", "乙"])).toBe("甲和乙");
    expect(formatRelativeTime(-3, "day")).toBe("3天前");
  });

  it("shortens a long list of names and leaves the rest to the caller", () => {
    const more = (shown: string, rest: number) => `${shown} +${rest}`;
    expect(formatNameList(["a", "b"], more)).toBe("a and b");
    expect(formatNameList(["a", "b", "c", "d"], more, 3)).toBe("a, b, c +1");
    expect(formatNameList(["a", "b", "c"], more, 3)).toBe("a, b, and c");
  });
});
