// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

const loaded = vi.hoisted(() => ({
  toolbar: vi.fn(),
  share: vi.fn(),
  dialog: vi.fn(),
  presence: vi.fn(),
  keeper: vi.fn(),
  pane: vi.fn(),
  sharedWithYou: vi.fn(),
  openLink: vi.fn(),
}));

vi.mock("@/features/collab/sharing/CollabToolbarItem", () => ({
  CollabToolbarItem: () => {
    loaded.toolbar();
    return <span>{"collab toolbar"}</span>;
  },
  CollabShareButton: () => {
    loaded.share();
    return <button type="button">{"share button"}</button>;
  },
}));
vi.mock("@/features/collab/sharing/ShareDialog", () => ({
  ShareDialog: (props: { projectId: string }) => {
    loaded.dialog(props);
    return <span>{`share dialog ${props.projectId}`}</span>;
  },
}));
vi.mock("@/features/collab/sharing/TreePresence", () => ({
  TreePresence: (props: unknown) => {
    loaded.presence(props);
    return null;
  },
}));
vi.mock("@/features/collab/sharing/CollabActivityKeeper", () => ({
  CollabActivityKeeper: () => {
    loaded.keeper();
    return null;
  },
}));
vi.mock("@/features/collab/sharing/CollabPane", () => ({
  CollabPane: () => {
    loaded.pane();
    return <span>{"collab pane"}</span>;
  },
}));
vi.mock("@/features/collab/sharing/SharedWithYou", () => ({
  SharedWithYou: () => {
    loaded.sharedWithYou();
    return <span>{"shared with you"}</span>;
  },
}));
vi.mock("@/features/collab/sharing/OpenLinkDialog", () => ({
  OpenLinkDialog: () => {
    loaded.openLink();
    return <span>{"open link dialog"}</span>;
  },
}));

import {
  CollabActivitySlot,
  CollabPanel,
  CollabShareSlot,
  CollabToolbarSlot,
  CollabTreePresenceSlot,
  OpenLinkDialogSlot,
  ShareDialogHost,
  SharedWithYouSlot,
  TreeRowPeers,
} from "./CollabSlots";
import { useShareDialog } from "./share-dialog";

function renderEverySlot() {
  return render(
    <>
      <CollabToolbarSlot />
      <CollabShareSlot />
      <ShareDialogHost />
      <CollabTreePresenceSlot onChange={() => undefined} />
      <CollabActivitySlot />
      <CollabPanel />
      <SharedWithYouSlot />
      <OpenLinkDialogSlot open onClose={() => undefined} />
    </>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useShareDialog.setState({ projectId: null });
  useFilesStore.setState({ projectId: "grant" });
});

afterEach(() => {
  useSettingsStore.setState({ liveCollaboration: false });
  useFilesStore.setState({ projectId: null });
});

describe("collaboration slots", () => {
  it("render nothing and load nothing while live collaboration is off", async () => {
    useSettingsStore.setState({ liveCollaboration: false });
    useShareDialog.setState({ projectId: "grant" });
    const { container } = renderEverySlot();
    await act(async () => {
      await Promise.resolve();
    });
    expect(container).toBeEmptyDOMElement();
    for (const component of Object.values(loaded)) expect(component).not.toHaveBeenCalled();
  });

  it("puts Share in a measured icon slot and loads the rest on demand when it is on", async () => {
    useSettingsStore.setState({ liveCollaboration: true });
    const { container } = renderEverySlot();
    expect(await screen.findByText("collab toolbar")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "share button" })).toBeInTheDocument();
    const share = container.querySelector('[data-toolbar-item="share"]');
    expect(share).toHaveAttribute("data-toolbar-icon");
    expect(share).not.toHaveAttribute("data-overflow-order");
    expect(share).toHaveTextContent("share button");
    expect(container.querySelector('[data-toolbar-item="share"]')).not.toHaveTextContent("collab toolbar");
    expect(await screen.findByText("collab pane")).toBeInTheDocument();
    expect(await screen.findByText("shared with you")).toBeInTheDocument();
    expect(await screen.findByText("open link dialog")).toBeInTheDocument();
    expect(loaded.toolbar).toHaveBeenCalled();
    expect(loaded.share).toHaveBeenCalled();
    expect(loaded.presence).toHaveBeenCalled();
    expect(loaded.keeper).toHaveBeenCalled();
    expect(loaded.dialog).not.toHaveBeenCalled();
  });

  it("adds no Share slot without an open project", async () => {
    useSettingsStore.setState({ liveCollaboration: true });
    useFilesStore.setState({ projectId: null });
    const { container } = render(<CollabShareSlot />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(container).toBeEmptyDOMElement();
    expect(loaded.share).not.toHaveBeenCalled();
  });

  it("opens the share dialog for the project someone asked to share", async () => {
    useSettingsStore.setState({ liveCollaboration: true });
    render(<ShareDialogHost />);
    act(() => useShareDialog.getState().openFor("grant"));
    expect(await screen.findByText("share dialog grant")).toBeInTheDocument();
    act(() => useShareDialog.getState().close());
    expect(screen.queryByText("share dialog grant")).toBeNull();
  });
});

describe("TreeRowPeers", () => {
  it("draws one labelled dot per person in their colour", () => {
    render(
      <TreeRowPeers
        marks={[
          { id: "alice", hue: 200, label: "Alice Chen is in this file" },
          { id: "bob", hue: 20, label: "Bob Smith is in this file" },
        ]}
      />,
    );
    const alice = screen.getByRole("img", { name: "Alice Chen is in this file" });
    expect(alice).toHaveAttribute("title", "Alice Chen is in this file");
    expect(alice).toHaveStyle({ backgroundColor: "hsl(200 55% 45%)" });
    expect(screen.getByRole("img", { name: "Bob Smith is in this file" })).toBeInTheDocument();
  });

  it("draws nothing for a file nobody has open", () => {
    const { container } = render(<TreeRowPeers marks={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
