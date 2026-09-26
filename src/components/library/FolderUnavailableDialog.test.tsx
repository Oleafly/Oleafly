// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ProjectAvailability, ProjectInfo } from "@/lib/tauri";
import type { UnavailableFolder } from "@/components/library/folder-state";

const locateProjectFolder = vi.fn<(projectId: string) => Promise<string>>();
const adoptReplacedFolder = vi.fn<(projectId: string) => Promise<string>>();
const check = vi.fn<
  (ids: readonly string[], options?: { force?: boolean }) => Promise<Record<string, ProjectAvailability>>
>();
const notifyError = vi.fn();
const platform = vi.hoisted(() => ({ mac: true }));

vi.mock("@/lib/tauri", () => ({
  locateProjectFolder: (projectId: string) => locateProjectFolder(projectId),
  adoptReplacedFolder: (projectId: string) => adoptReplacedFolder(projectId),
}));
vi.mock("@/lib/toast", () => ({
  notifyError: (...args: unknown[]) => notifyError(...args),
}));
vi.mock("@/store/library-availability", () => ({
  useLibraryAvailabilityStore: (select: (state: { check: typeof check }) => unknown) =>
    select({ check }),
}));
vi.mock("@/lib/utils", async (original) => ({
  ...(await original<typeof import("@/lib/utils")>()),
  get isMac() {
    return platform.mac;
  },
}));

import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enLibrary from "@/i18n/locales/en/library.json" with { type: "json" };
import { FolderUnavailableDialog } from "./FolderUnavailableDialog";

const THESIS: ProjectInfo = {
  id: "linked-thesis",
  name: "Thesis",
  main_doc: "main.tex",
  engine: "tectonic",
  kind: "document",
  created_at: 1,
  updated_at: 1,
  color: "",
  has_preview: false,
  exports: [],
  forked_from: null,
  recovery_pending: false,
  location: { kind: "linked", display_path: "~/Desktop/thesis", availability: "unknown" },
};

const onClose = vi.fn();
const onOpen = vi.fn();
const onRemove = vi.fn();
const unavailable = enLibrary.folder.unavailable;
const fill = (text: string) =>
  text.replace("{{name}}", "Thesis").replace("{{path}}", "~/Desktop/thesis");

function show(availability: UnavailableFolder) {
  return render(
    <FolderUnavailableDialog
      project={THESIS}
      availability={availability}
      onClose={onClose}
      onOpen={onOpen}
      onRemove={onRemove}
    />,
  );
}

beforeEach(() => {
  platform.mac = true;
  for (const mock of [locateProjectFolder, adoptReplacedFolder, check, notifyError, onClose, onOpen, onRemove]) {
    mock.mockReset();
  }
});

describe("FolderUnavailableDialog", () => {
  it("renders nothing without a folder", () => {
    render(
      <FolderUnavailableDialog
        project={null}
        availability="missing"
        onClose={onClose}
        onOpen={onOpen}
        onRemove={onRemove}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers Locate for a missing folder and opens it once found", async () => {
    locateProjectFolder.mockResolvedValue("rebound");
    check.mockResolvedValue({ "linked-thesis": "ok" });
    show("missing");
    expect(screen.getByRole("heading", { name: fill(unavailable.missing.title) })).toBeInTheDocument();
    expect(screen.getByText(fill(unavailable.missing.body))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: unavailable.tryAgain })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: unavailable.locate }));

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("linked-thesis"));
    expect(locateProjectFolder).toHaveBeenCalledWith("linked-thesis");
    expect(check).toHaveBeenCalledWith(["linked-thesis"], { force: true });
  });

  it("stays put when Locate is cancelled or fails", async () => {
    locateProjectFolder.mockResolvedValueOnce("cancelled");
    show("missing");
    fireEvent.click(screen.getByRole("button", { name: unavailable.locate }));
    await waitFor(() => expect(locateProjectFolder).toHaveBeenCalledTimes(1));
    expect(onOpen).not.toHaveBeenCalled();

    locateProjectFolder.mockRejectedValueOnce(new Error("picker failed"));
    fireEvent.click(screen.getByRole("button", { name: unavailable.locate }));
    await waitFor(() => expect(notifyError).toHaveBeenCalledTimes(1));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("checks an offline drive again and says so when it is still away", async () => {
    check.mockResolvedValueOnce({ "linked-thesis": "offline" });
    show("offline");
    expect(screen.getByRole("heading", { name: fill(unavailable.offline.title) })).toBeInTheDocument();
    expect(screen.getByText(fill(unavailable.offline.body))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: unavailable.tryAgain }));

    expect(await screen.findByText(unavailable.still)).toBeInTheDocument();
    expect(onOpen).not.toHaveBeenCalled();

    check.mockResolvedValueOnce({ "linked-thesis": "ok" });
    fireEvent.click(screen.getByRole("button", { name: unavailable.tryAgain }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("linked-thesis"));
  });

  it("shows the check in progress on the button", async () => {
    let finish: (value: Record<string, ProjectAvailability>) => void = () => {};
    check.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    show("offline");
    const button = screen.getByRole("button", { name: unavailable.tryAgain });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleName(unavailable.checking);
    expect(within(button).getByText(unavailable.checking)).not.toHaveClass("invisible");
    expect(within(button).getByText(unavailable.tryAgain)).toHaveClass("invisible");
    await act(async () => finish({ "linked-thesis": "offline" }));
    expect(button).toBeEnabled();
    expect(button).toHaveAccessibleName(unavailable.tryAgain);
    expect(within(button).getByText(unavailable.checking)).toHaveClass("invisible");
  });

  it("lets the user take over a replaced folder", async () => {
    adoptReplacedFolder.mockResolvedValue("rebound");
    check.mockResolvedValue({ "linked-thesis": "ok" });
    show("replaced");
    expect(screen.getByRole("heading", { name: fill(unavailable.replaced.title) })).toBeInTheDocument();
    expect(screen.getByText(fill(unavailable.replaced.body))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: unavailable.useThisFolder }));

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("linked-thesis"));
    expect(adoptReplacedFolder).toHaveBeenCalledWith("linked-thesis");
  });

  it("gives platform guidance when permission is denied", () => {
    const view = show("permission_denied");
    expect(
      screen.getByRole("heading", { name: fill(unavailable.permissionDenied.title) }),
    ).toBeInTheDocument();
    expect(screen.getByText(unavailable.permissionDenied.bodyMac)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: unavailable.locate })).toBeNull();
    view.unmount();

    platform.mac = false;
    show("permission_denied");
    expect(screen.getByText(fill(unavailable.permissionDenied.bodyOther))).toBeInTheDocument();
  });

  it.each([
    ["missing", unavailable.locate],
    ["offline", unavailable.tryAgain],
    ["replaced", unavailable.useThisFolder],
    ["permission_denied", unavailable.tryAgain],
  ] as const)("starts a %s folder on its main action, never on Remove", async (state, action) => {
    show(state);
    await waitFor(() => expect(screen.getByRole("button", { name: action })).toHaveFocus());
    expect(screen.getByRole("button", { name: enLibrary.folder.menu.remove })).not.toHaveFocus();
  });

  it("keeps the problem it opened with and says so when the folder comes back", async () => {
    const view = show("offline");
    view.rerender(
      <FolderUnavailableDialog
        project={THESIS}
        availability="offline"
        reachable
        onClose={onClose}
        onOpen={onOpen}
        onRemove={onRemove}
      />,
    );

    expect(screen.getByRole("heading", { name: fill(unavailable.back.title) })).toBeInTheDocument();
    expect(screen.getByText(fill(unavailable.back.body))).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: fill(unavailable.missing.title) })).toBeNull();
    expect(screen.queryByRole("button", { name: unavailable.locate })).toBeNull();
    const open = screen.getByRole("button", { name: enCommon.actions.open });
    await waitFor(() => expect(open).toHaveFocus());
    fireEvent.click(open);
    expect(onOpen).toHaveBeenCalledWith("linked-thesis");
  });

  it("follows the answer to its own check", async () => {
    check.mockResolvedValueOnce({ "linked-thesis": "missing" });
    show("offline");
    fireEvent.click(screen.getByRole("button", { name: unavailable.tryAgain }));
    expect(
      await screen.findByRole("heading", { name: fill(unavailable.missing.title) }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: unavailable.locate })).toBeInTheDocument();
    expect(screen.queryByText(unavailable.still)).toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("hands removal back to the library and closes on cancel", () => {
    show("missing");
    fireEvent.click(screen.getByRole("button", { name: enLibrary.folder.menu.remove }));
    expect(onRemove).toHaveBeenCalledWith(THESIS);
    fireEvent.click(screen.getByRole("button", { name: enCommon.actions.cancel }));
    expect(onClose).toHaveBeenCalled();
  });
});
