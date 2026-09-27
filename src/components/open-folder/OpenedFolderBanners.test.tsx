// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import type { FolderStatus, ProjectTrust } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({
  projectTrustState: vi.fn(),
  projectFolderStatus: vi.fn(),
  trustFolder: vi.fn(),
  copyIntoLibrary: vi.fn(),
  openProject: vi.fn(),
  notifyError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  projectTrustState: mocks.projectTrustState,
  projectFolderStatus: mocks.projectFolderStatus,
  trustFolder: mocks.trustFolder,
}));
vi.mock("@/store/copy-into-library", async () => {
  const { create } = await import("zustand");
  return {
    copyIntoLibrary: mocks.copyIntoLibrary,
    useCopyIntoLibraryStore: create(() => ({ status: "idle" })),
  };
});
vi.mock("@/lib/toast", () => ({
  notifyError: mocks.notifyError,
  toast: { success: mocks.toastSuccess },
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn(async () => {}) }));
vi.mock("@/store/files", async () => {
  const { create } = await import("zustand");
  return {
    useFilesStore: create(() => ({
      projectId: "linked-a" as string | null,
      projectName: "thesis",
      openProject: mocks.openProject,
    })),
  };
});

import { loadFolderAccess, useFolderAccessStore } from "@/store/folder-access";
import { useProjectAvailabilityStore } from "@/store/project-availability";
import { OpenedFolderBanners } from "./OpenedFolderBanners";

const labels = enShell.openedFolder;
const restricted: ProjectTrust = { trusted: false, source: null, parent: "papers", repository: null };
const trusted: ProjectTrust = { trusted: true, source: "folder", parent: "papers", repository: null };

async function open(
  trust: ProjectTrust = restricted,
  status: FolderStatus = { read_only: false, synced_with: null },
) {
  mocks.projectTrustState.mockResolvedValue(trust);
  mocks.projectFolderStatus.mockResolvedValue(status);
  await act(async () => {
    await loadFolderAccess("linked-a");
  });
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.openProject.mockResolvedValue(undefined);
  useProjectAvailabilityStore.getState().reset("linked-a");
  useFolderAccessStore.setState({ hiddenBanners: [] });
  useFolderAccessStore.getState().reset(null);
});

afterEach(() => {
  useFolderAccessStore.getState().reset(null);
  useProjectAvailabilityStore.getState().reset(null);
});

describe("trust banner", () => {
  it("stays hidden until the folder's trust is known", () => {
    render(<OpenedFolderBanners />);
    expect(screen.queryByTestId("folder-trust-banner")).not.toBeInTheDocument();
  });

  it("explains restricted mode inline and offers both trust scopes", async () => {
    render(<OpenedFolderBanners />);
    await open();
    const banner = screen.getByTestId("folder-trust-banner");
    expect(banner).toHaveTextContent(labels.trust.banner);
    expect(screen.getByRole("button", { name: labels.trust.trustFolder })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: labels.trust.trustParent })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks the owner's question and names the parent button without an ellipsis", async () => {
    render(<OpenedFolderBanners />);
    await open();
    expect(screen.getByTestId("folder-trust-banner")).toHaveTextContent(
      "Oleafly limited some features in this folder. Trust it to turn on Git, terminal, agents and shell escape?",
    );
    expect(screen.getByRole("button", { name: "Trust the parent folder" })).toBeInTheDocument();
  });

  it("sits on an opaque surface so the window behind never shows through", async () => {
    render(<OpenedFolderBanners />);
    await open();
    const banner = screen.getByTestId("folder-trust-banner");
    expect(banner.className).toContain("bg-[color-mix(in_srgb,var(--primary)_5%,var(--background))]");
    expect(banner.className).not.toMatch(/(^|\s)bg-[\w-]+\/\d+/);
    expect(banner.className).toContain("border-primary/20");
    expect(banner.querySelector("svg")?.getAttribute("class")).toContain("text-primary");
  });

  it("leaves out the parent choice when the parent is too broad to trust", async () => {
    render(<OpenedFolderBanners />);
    await open({ ...restricted, parent: null });
    expect(screen.queryByRole("button", { name: labels.trust.trustParent })).not.toBeInTheDocument();
  });

  it("disappears as soon as the folder is trusted", async () => {
    mocks.trustFolder.mockResolvedValue(trusted);
    render(<OpenedFolderBanners />);
    await open();
    fireEvent.click(screen.getByRole("button", { name: labels.trust.trustFolder }));
    await waitFor(() =>
      expect(screen.queryByTestId("folder-trust-banner")).not.toBeInTheDocument(),
    );
    expect(mocks.trustFolder).toHaveBeenCalledWith("linked-a", "folder");
  });

  it("trusts the parent folder from its own button", async () => {
    mocks.trustFolder.mockResolvedValue({ ...trusted, source: "parent_folder" });
    render(<OpenedFolderBanners />);
    await open();
    fireEvent.click(screen.getByRole("button", { name: labels.trust.trustParent }));
    await waitFor(() => expect(mocks.trustFolder).toHaveBeenCalledWith("linked-a", "parent"));
  });

  it("can be hidden for the rest of the session", async () => {
    render(<OpenedFolderBanners />);
    await open();
    fireEvent.click(screen.getByRole("button", { name: labels.trust.hide }));
    expect(screen.queryByTestId("folder-trust-banner")).not.toBeInTheDocument();
    await open();
    expect(screen.queryByTestId("folder-trust-banner")).not.toBeInTheDocument();
  });

  it("never shows for a trusted folder or a library project", async () => {
    render(<OpenedFolderBanners />);
    await open(trusted);
    expect(screen.queryByTestId("folder-trust-banner")).not.toBeInTheDocument();
  });

  it("gives way to the folder-unavailable banner", async () => {
    render(<OpenedFolderBanners />);
    await open(restricted, { read_only: true, synced_with: null });
    act(() => useProjectAvailabilityStore.getState().report("linked-a", "missing"));
    expect(screen.queryByTestId("folder-trust-banner")).not.toBeInTheDocument();
    expect(screen.queryByTestId("folder-read-only-banner")).not.toBeInTheDocument();
  });

  it("uses tint and border changes only, never a ring or outline", async () => {
    render(<OpenedFolderBanners />);
    await open(restricted, { read_only: true, synced_with: null });
    for (const button of screen.getAllByRole("button")) {
      expect(button.className).not.toMatch(/ring|outline/);
    }
  });
});

describe("trust banner copy in every language", () => {
  const catalogs = import.meta.glob<{ openedFolder: { trust: { banner: string; trustParent: string } } }>(
    "../../i18n/locales/*/shell.json",
    { eager: true, import: "default" },
  );
  const entries = Object.entries(catalogs).map(([path, catalog]) => [
    path.split("/").at(-2) ?? path,
    catalog.openedFolder.trust,
  ] as const);

  it("covers all 21 catalogs", () => {
    expect(entries).toHaveLength(21);
  });

  it.each(entries)("%s ends the banner with a question", (locale, trust) => {
    const mark = locale.startsWith("zh-") || locale === "ja" ? "\uFF1F" : "?";
    expect(trust.banner.endsWith(mark)).toBe(true);
    expect(trust.banner).not.toMatch(/[.\u3002]$/);
  });

  it.each(entries)("%s names the parent button without an ellipsis", (_locale, trust) => {
    expect(trust.trustParent).not.toMatch(/(\u2026|\.\.\.)\s*$/);
  });
});

describe("read-only banner", () => {
  it("says edits cannot be saved and stacks above the trust banner", async () => {
    render(<OpenedFolderBanners />);
    await open(restricted, { read_only: true, synced_with: null });
    const readOnly = screen.getByTestId("folder-read-only-banner");
    expect(readOnly).toHaveTextContent(labels.readOnly.banner);
    const trust = screen.getByTestId("folder-trust-banner");
    expect(readOnly.compareDocumentPosition(trust) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("copies the folder into the library through the shared copy flow and opens the copy", async () => {
    mocks.copyIntoLibrary.mockResolvedValue("thesis-copy");
    render(<OpenedFolderBanners />);
    await open(trusted, { read_only: true, synced_with: null });
    fireEvent.click(screen.getByRole("button", { name: labels.readOnly.copy }));
    await waitFor(() =>
      expect(mocks.copyIntoLibrary).toHaveBeenCalledWith("linked-a", "thesis", {
        openAfterCopy: true,
      }),
    );
    expect(mocks.copyIntoLibrary).toHaveBeenCalledTimes(1);
  });

  it("stays hidden for a writable folder", async () => {
    render(<OpenedFolderBanners />);
    await open(trusted, { read_only: false, synced_with: "icloud_drive" });
    expect(screen.queryByTestId("folder-read-only-banner")).not.toBeInTheDocument();
  });
});
