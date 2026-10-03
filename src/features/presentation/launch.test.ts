import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startPresentation: vi.fn(),
  offline: false,
}));

vi.mock("@/features/presentation/open", () => ({ startPresentation: mocks.startPresentation }));
vi.mock("@/store/settings", () => ({ useSettingsStore: { getState: () => ({ offline: mocks.offline }) } }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

import { useTypstVariantStore } from "@/store/typst-variant";
import { present } from "./launch";

beforeEach(() => {
  mocks.startPresentation.mockReset();
  mocks.startPresentation.mockResolvedValue(null);
  mocks.offline = false;
  useTypstVariantStore.setState({ selections: { deck: "review" } });
});

describe("present", () => {
  it("starts Typst slides with the chosen variant and the offline mode", async () => {
    mocks.offline = true;
    await present({ projectId: "deck", mode: "presenter", page: 3, mainDoc: "main.typ", typst: true });
    expect(mocks.startPresentation).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "deck", presenter: true, typst: true, variant: "review", offline: true }),
    );
  });

  it("starts other decks without a variant", async () => {
    await present({ projectId: "deck", mode: "page", page: 2, mainDoc: "talk.tex", typst: false });
    expect(mocks.startPresentation).toHaveBeenCalledWith(
      expect.objectContaining({ start: 2, typst: false, variant: null, offline: false }),
    );
  });
});
