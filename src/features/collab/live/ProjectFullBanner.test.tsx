// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";

vi.mock("@/store/files", async () => {
  const { create } = await import("zustand");
  return {
    useFilesStore: create(() => ({ projectId: "paper" as string | null })),
    onPathsMoved: () => () => {},
  };
});

import { useFilesStore } from "@/store/files";
import { useCollabLiveStore } from "./live-store";
import { ProjectFullBanner } from "./ProjectFullBanner";

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  useFilesStore.setState({ projectId: "paper" });
  useCollabLiveStore.setState({ projectId: "paper", projectFull: false });
});

afterEach(() => {
  useCollabLiveStore.setState({ projectId: null, projectFull: false });
});

describe("ProjectFullBanner", () => {
  it("stays out of the way while the server takes the project's changes", () => {
    render(<ProjectFullBanner />);
    expect(screen.queryByTestId("collab-project-full")).toBeNull();
  });

  it("says the changes stay on this computer once the project reaches the server's limit", () => {
    render(<ProjectFullBanner />);
    // The status region is mounted, empty, before the banner, so screen
    // readers announce the banner when it appears.
    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();
    act(() => useCollabLiveStore.setState({ projectFull: true }));
    const banner = screen.getByTestId("collab-project-full");
    expect(banner).toHaveTextContent(enCollab.files.projectFull);
    expect(screen.getByRole("status")).toBe(status);
    expect(status).toHaveTextContent(enCollab.files.projectFull);
    act(() => useCollabLiveStore.setState({ projectFull: false }));
    expect(screen.queryByTestId("collab-project-full")).toBeNull();
    expect(status).toBeEmptyDOMElement();
  });

  it("belongs to the live project only", () => {
    render(<ProjectFullBanner />);
    act(() => useCollabLiveStore.setState({ projectId: "thesis", projectFull: true }));
    expect(screen.queryByTestId("collab-project-full")).toBeNull();
  });
});
