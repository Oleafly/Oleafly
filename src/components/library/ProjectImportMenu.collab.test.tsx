// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ dialog: vi.fn() }));

vi.mock("@/store/github", () => ({
  useGithubStore: (selector: (state: unknown) => unknown) => selector({ status: "disconnected", refresh: vi.fn() }),
}));
vi.mock("@/lib/github", () => ({ githubListRepos: vi.fn(async () => []) }));
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
import { ProjectImportMenu } from "./ProjectImportMenu";

function openMenu() {
  fireEvent.pointerDown(screen.getByRole("button", { name: "Open import menu" }), { button: 0, ctrlKey: false });
}

function renderMenu() {
  return render(<ProjectImportMenu trigger={() => <button type="button">{"Open import menu"}</button>} />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ProjectImportMenu shared project link", () => {
  it("opens the shared link dialog from the Cloud group", async () => {
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
});
