// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { useLiveBackend } from "@/lib/collab-live-bridge";
import { EMPTY_DOCUMENT_STATS } from "@/lib/document-stats";
import type { OverleafLiveSettings } from "@/lib/overleaf-live";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

const mocks = vi.hoisted(() => ({
  overleafLiveSettings: vi.fn(),
  overleafLiveSetSetting: vi.fn(),
  notifyError: vi.fn(),
}));

vi.mock("@/lib/toast", () => ({
  notifyError: mocks.notifyError,
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/overleaf-live", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/overleaf-live")>()),
  overleafLiveSettings: mocks.overleafLiveSettings,
  overleafLiveSetSetting: mocks.overleafLiveSetSetting,
}));

const { ProjectInfoContent } = await import("./ProjectInfo");

const copy = enEditor.projectInfo;
const SNAPSHOT = { root: "/papers/grant", fileCount: 3, unreadable: [], stats: EMPTY_DOCUMENT_STATS, selectionWords: null };
const LINK = { server: "https://latex.uni.edu", remoteId: "6af963ebc9037022065bb53f", signedIn: true, paused: false };

function settings(overrides: Partial<OverleafLiveSettings> = {}): OverleafLiveSettings {
  return {
    image: "texlive-full:2025.1",
    images: [
      { name: "texlive-full:2025.1", description: "TeX Live 2025" },
      { name: "texlive-full:2026.1", description: "TeX Live 2026" },
    ],
    bibliography: null,
    bibliographies: ["refs.bib", "more/extra.bib"],
    canChange: true,
    ...overrides,
  };
}

function live(paused = false) {
  useLiveBackend.setState({ projectId: "grant", backend: "overleaf", overleaf: { ...LINK, paused } });
}

function show() {
  return render(<ProjectInfoContent snapshot={SNAPSHOT} surface="source" />);
}

beforeAll(async () => {
  for (const [name, value] of [
    ["hasPointerCapture", () => false],
    ["releasePointerCapture", () => {}],
    ["scrollIntoView", () => {}],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value });
  }
  await loadNamespace("editor");
});

beforeEach(() => {
  vi.clearAllMocks();
  useFilesStore.setState({ projectId: "grant" });
  useSettingsStore.setState({ spellcheck: false });
  mocks.overleafLiveSettings.mockResolvedValue(settings());
  mocks.overleafLiveSetSetting.mockResolvedValue(undefined);
});

afterEach(() => {
  useLiveBackend.setState({ projectId: null, backend: null, overleaf: null });
});

describe("On Overleaf settings", () => {
  it("is hidden for projects that aren't live on Overleaf, including paused ones", async () => {
    const { unmount } = show();
    expect(screen.queryByTestId("overleaf-project-settings")).toBeNull();
    unmount();
    live(true);
    show();
    expect(screen.queryByTestId("overleaf-project-settings")).toBeNull();
    expect(mocks.overleafLiveSettings).not.toHaveBeenCalled();
  });

  it("picks the TeX Live version and the main bibliography on Overleaf", async () => {
    const user = userEvent.setup();
    live();
    show();
    expect(await screen.findByText(copy.onOverleaf)).toBeInTheDocument();
    expect(screen.getByTestId("overleaf-tex-live")).toHaveTextContent("TeX Live 2025");
    expect(screen.getByTestId("overleaf-bibliography")).toHaveTextContent(copy.bibliographyNone);
    await user.click(screen.getByTestId("overleaf-tex-live"));
    await user.click(await screen.findByRole("option", { name: "TeX Live 2026" }));
    await waitFor(() =>
      expect(mocks.overleafLiveSetSetting).toHaveBeenCalledWith("grant", "image", "texlive-full:2026.1"),
    );
    mocks.overleafLiveSettings.mockResolvedValue(settings({ bibliography: "refs.bib" }));
    await user.click(screen.getByTestId("overleaf-bibliography"));
    await user.click(await screen.findByRole("option", { name: "refs.bib" }));
    await waitFor(() => expect(mocks.overleafLiveSetSetting).toHaveBeenCalledWith("grant", "bibliography", "refs.bib"));
    await waitFor(() => expect(screen.getByTestId("overleaf-bibliography")).toHaveTextContent("refs.bib"));
  });

  it("hides the TeX Live picker when the server offers none and locks both for reviewers", async () => {
    mocks.overleafLiveSettings.mockResolvedValue(settings({ images: [], image: null, canChange: false }));
    live();
    show();
    expect(await screen.findByText(copy.overleafReadOnly)).toBeInTheDocument();
    expect(screen.queryByTestId("overleaf-tex-live")).toBeNull();
    expect(screen.getByTestId("overleaf-bibliography")).toBeDisabled();
  });

  it("says so when Overleaf turns the change down", async () => {
    const user = userEvent.setup();
    mocks.overleafLiveSetSetting.mockRejectedValueOnce({ code: "forbidden", message: "no" });
    live();
    show();
    await user.click(await screen.findByTestId("overleaf-bibliography"));
    await user.click(await screen.findByRole("option", { name: "refs.bib" }));
    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(
        "change an overleaf project setting",
        { code: "forbidden", message: "no" },
        copy.overleafFailed,
      ),
    );
  });
});
