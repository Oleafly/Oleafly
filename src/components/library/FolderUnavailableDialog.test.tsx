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
  displayHomes: () => Promise.resolve([]),
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
import { buttonVariants } from "@/components/ui/button";
import { resetDisplayHomes, setDisplayHomes } from "@/lib/display-path";
import { cn } from "@/lib/utils";
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
const smallButton = (variant: "default" | "outline") =>
  cn(buttonVariants({ variant, size: "sm" }));
const fill = (text: string) =>
  text.replace("{{name}}", "Thesis").replace("{{path}}", "~/Desktop/thesis");
const plain = (text: string) => fill(text).replace(/<\/?path>/g, "");
const described = (text: string) =>
  expect(screen.getByRole("dialog")).toHaveAccessibleDescription(plain(text));

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
  resetDisplayHomes();
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

  it.each(["missing", "offline", "replaced"] as const)(
    "shows the %s folder's path as a badge and no icon",
    (state) => {
      show(state);
      const dialog = screen.getByRole("dialog");
      const badge = within(dialog).getByText("~/Desktop/thesis");
      expect(badge.tagName).toBe("SPAN");
      expect(badge).toHaveClass("font-mono", "bg-muted", "break-all");
      const heading = screen.getByRole("heading", { name: fill(unavailable[state].title) });
      expect(heading.parentElement?.querySelector("svg")).toBeNull();
    },
  );

  it("keeps a path that looks like markup as plain text", () => {
    const path = "~/Desktop/<draft> & <i>notes</i>";
    render(
      <FolderUnavailableDialog
        project={{ ...THESIS, location: { kind: "linked", display_path: path, availability: "unknown" } }}
        availability="missing"
        onClose={onClose}
        onOpen={onOpen}
        onRemove={onRemove}
      />,
    );
    expect(within(screen.getByRole("dialog")).getByText(path)).toHaveClass("font-mono");
  });

  it("shortens a home path the backend left in full, whichever home it names", () => {
    setDisplayHomes([String.raw`C:\msys64\home\ada`, String.raw`C:\Users\ada`]);
    render(
      <FolderUnavailableDialog
        project={{
          ...THESIS,
          location: {
            kind: "linked",
            display_path: String.raw`C:\Users\ada\Documents\thesis`,
            availability: "unknown",
          },
        }}
        availability="missing"
        onClose={onClose}
        onOpen={onOpen}
        onRemove={onRemove}
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(String.raw`~\Documents\thesis`)).toHaveClass("font-mono");
    expect(dialog.textContent).not.toMatch(/Users\\ada/i);
  });

  it("offers Locate for a missing folder and opens it once found", async () => {
    locateProjectFolder.mockResolvedValue("rebound");
    check.mockResolvedValue({ "linked-thesis": "ok" });
    show("missing");
    expect(screen.getByRole("heading", { name: fill(unavailable.missing.title) })).toBeInTheDocument();
    described(unavailable.missing.body);
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
    described(unavailable.offline.body);

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
    described(unavailable.replaced.body);

    fireEvent.click(screen.getByRole("button", { name: unavailable.useThisFolder }));

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("linked-thesis"));
    expect(adoptReplacedFolder).toHaveBeenCalledWith("linked-thesis");
  });

  it("gives platform guidance when permission is denied", () => {
    const view = show("permission_denied");
    expect(
      screen.getByRole("heading", { name: fill(unavailable.permissionDenied.title) }),
    ).toBeInTheDocument();
    described(unavailable.permissionDenied.bodyMac);
    expect(screen.queryByRole("button", { name: unavailable.locate })).toBeNull();
    view.unmount();

    platform.mac = false;
    show("permission_denied");
    described(unavailable.permissionDenied.bodyOther);
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

  it.each([
    ["missing", [[unavailable.locate, "default"]]],
    [
      "offline",
      [
        [unavailable.locate, "outline"],
        [unavailable.tryAgain, "default"],
      ],
    ],
    [
      "replaced",
      [
        [unavailable.locate, "outline"],
        [unavailable.useThisFolder, "default"],
      ],
    ],
    ["permission_denied", [[unavailable.tryAgain, "default"]]],
  ] as const)("lays out the %s actions after Remove and Cancel", (state, actions) => {
    show(state);
    const footer = screen.getByRole("button", { name: enCommon.actions.cancel })
      .parentElement as HTMLElement;
    const buttons = within(footer).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
      enLibrary.folder.menu.remove,
      enCommon.actions.cancel,
      ...actions.map(([name]) =>
        name === unavailable.tryAgain ? `${name}${unavailable.checking}` : name,
      ),
    ]);
    buttons.slice(2).forEach((button, index) => {
      expect(button.className).toBe(smallButton(actions[index][1]));
      expect(button).toBeEnabled();
    });
  });

  it("moves focus to the new main action when its own check finds another problem", async () => {
    check.mockResolvedValueOnce({ "linked-thesis": "replaced" });
    show("offline");
    const tryAgain = screen.getByRole("button", { name: unavailable.tryAgain });
    await waitFor(() => expect(tryAgain).toHaveFocus());
    fireEvent.click(tryAgain);
    const adopt = await screen.findByRole("button", { name: unavailable.useThisFolder });
    await waitFor(() => expect(adopt).toHaveFocus());
    expect(tryAgain).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: unavailable.locate }).className).toBe(
      smallButton("outline"),
    );
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
    described(unavailable.back.body);
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

  it("closes on Escape", () => {
    show("offline");

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

