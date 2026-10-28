// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ dialog: vi.fn() }));

const forgeState = vi.hoisted(() => ({
  status: "ready",
  accounts: [] as unknown[],
  ensureLoaded: vi.fn(async () => [] as unknown[]),
}));

vi.mock("@/store/forge-accounts", () => ({
  useForgeAccountsStore: Object.assign(
    (selector: (state: typeof forgeState) => unknown) => selector(forgeState),
    { getState: () => forgeState },
  ),
}));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  forgeListRepos: vi.fn(async () => ({ repos: [], nextPage: null, searched: false })),
}));
vi.mock("@/features/collab/sharing/OpenLinkDialog", () => ({
  OpenLinkDialog: ({ onClose }: { onClose: () => void }) => {
    mocks.dialog();
    return (
      <div role="dialog">
        <button type="button" onClick={onClose}>
          {"Close link dialog"}
        </button>
      </div>
    );
  },
}));

import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { useSettingsStore } from "@/store/settings";
import { ProjectImportMenu } from "./ProjectImportMenu";

function openMenu() {
  fireEvent.pointerDown(screen.getByRole("button", { name: "Open import menu" }), { button: 0, ctrlKey: false });
}

function renderMenu() {
  return render(<ProjectImportMenu trigger={() => <button type="button">{"Open import menu"}</button>} />);
}

// The menu adds the shared link item once the collaboration surfaces load
// lazily. Load them here, so the menu waits on rendering, not on compiling
// the module graph, which can take seconds on a busy machine.
beforeAll(async () => {
  await import("@/features/collab/sharing/surfaces");
}, 60_000);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  useSettingsStore.setState({ liveCollaboration: false });
});

describe("ProjectImportMenu shared project link", () => {
  it("opens the shared link dialog from the Cloud group", async () => {
    useSettingsStore.setState({ liveCollaboration: true });
    renderMenu();
    await act(async () => {
      await Promise.resolve();
    });
    openMenu();
    const item = await screen.findByRole("menuitem", { name: enCollab.library.openLink.menu });
    fireEvent.click(item);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close link dialog" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("leaves the menu as it was while live collaboration is off", async () => {
    renderMenu();
    openMenu();
    expect(await screen.findByTestId("import-git")).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: enCollab.library.openLink.menu })).toBeNull();
    expect(mocks.dialog).not.toHaveBeenCalled();
  });
});
