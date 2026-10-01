// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  HIDE_PERSONAL_DETAILS_ATTRIBUTE,
  togglePersonalDetails,
  usePersonalDetailsStore,
} from "@/store/personal-details";

afterEach(() => usePersonalDetailsStore.getState().setHidden(false));

describe("personal details store", () => {
  it("starts with personal details shown", () => {
    expect(usePersonalDetailsStore.getState().hidden).toBe(false);
    expect(document.documentElement.hasAttribute(HIDE_PERSONAL_DETAILS_ATTRIBUTE)).toBe(false);
  });

  it("toggles and marks the document so the blur rule applies", () => {
    togglePersonalDetails();
    expect(usePersonalDetailsStore.getState().hidden).toBe(true);
    expect(document.documentElement.hasAttribute(HIDE_PERSONAL_DETAILS_ATTRIBUTE)).toBe(true);

    togglePersonalDetails();
    expect(usePersonalDetailsStore.getState().hidden).toBe(false);
    expect(document.documentElement.hasAttribute(HIDE_PERSONAL_DETAILS_ATTRIBUTE)).toBe(false);
  });

  it("lasts for this session only", () => {
    const before = { ...localStorage };
    usePersonalDetailsStore.getState().setHidden(true);
    expect({ ...localStorage }).toEqual(before);
  });
});
