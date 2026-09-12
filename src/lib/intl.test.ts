import { afterEach, describe, expect, it } from "vitest";
import { applyLocale } from "@/i18n";
import { formatCompactNumber, formatList, formatNumber, formatRelativeTime } from "./intl";

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
});
