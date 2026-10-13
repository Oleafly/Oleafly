// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

const loaded = vi.hoisted(() => ({
  toolbar: vi.fn(),
  share: vi.fn(),
  dialog: vi.fn(),
  presence: vi.fn(),
  clashes: vi.fn(),
  keeper: vi.fn(),
  pane: vi.fn(),
  sharedWithYou: vi.fn(),
  openLink: vi.fn(),
  admin: vi.fn(),
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
vi.mock("@/features/collab/sharing/TreeClashes", () => ({
  TreeClashes: () => {
    loaded.clashes();
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

vi.mock("@/features/collab/console/AdminConsoleWindow", () => ({
  AdminConsoleWindow: () => {
    loaded.admin();
    return <span>{"admin console"}</span>;
  },
}));

import {
  AdminConsoleSlot,
  CollabActivitySlot,
  CollabPanel,
  CollabShareSlot,
  CollabToolbarSlot,
  CollabTreeClashSlot,
  CollabTreePresenceSlot,
  OpenLinkDialogSlot,
  ShareDialogHost,
  SharedWithYouSlot,
  TreeRowClash,
  TreeRowPeers,
} from "./CollabSlots";
import { useShareDialog } from "./share-dialog";
import { useTreeClashes } from "./tree-clashes";

function renderEverySlot() {
  return render(
    <>
      <CollabToolbarSlot />
      <CollabShareSlot />
      <ShareDialogHost />
      <CollabTreePresenceSlot onChange={() => undefined} />
      <CollabTreeClashSlot />
      <CollabActivitySlot />
      <CollabPanel />
      <SharedWithYouSlot />
      <OpenLinkDialogSlot open onClose={() => undefined} />
      <AdminConsoleSlot />
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
    expect(loaded.clashes).toHaveBeenCalled();
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

  it("opens the server admin console window only while live collaboration is on", async () => {
    useSettingsStore.setState({ liveCollaboration: true });
    render(<AdminConsoleSlot />);
    expect(await screen.findByText("admin console")).toBeInTheDocument();
    expect(loaded.admin).toHaveBeenCalled();
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
  beforeAll(async () => {
    await loadNamespace("collab");
  });

  beforeEach(() => {
    useSettingsStore.setState({ liveCollaboration: true });
  });

  it("draws nothing while live collaboration is off, even for a file someone has open", () => {
    useSettingsStore.setState({ liveCollaboration: false });
    const { container } = render(<TreeRowPeers marks={[{ id: "alice", hue: 200, label: "Alice Chen is in this file" }]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("draws one labelled dot per person in their colour and names them in the app tooltip", async () => {
    render(
      <TreeRowPeers
        marks={[
          { id: "alice", hue: 200, label: "Alice Chen is in this file" },
          { id: "bob", hue: 20, label: "Bob Smith is in this file" },
        ]}
      />,
    );
    const alice = await screen.findByRole("img", { name: "Alice Chen is in this file" });
    expect(alice).not.toHaveAttribute("title");
    expect(alice).toHaveStyle({ backgroundColor: "hsl(200 55% 45%)" });
    expect(screen.getByRole("img", { name: "Bob Smith is in this file" })).toBeInTheDocument();
    fireEvent.mouseEnter(alice.parentElement as HTMLElement);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Alice Chen is in this file");
  });

  it("draws nothing for a file nobody has open", () => {
    const { container } = render(<TreeRowPeers marks={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("TreeRowClash", () => {
  beforeAll(async () => {
    await loadNamespace("collab");
  });

  beforeEach(() => {
    useSettingsStore.setState({ liveCollaboration: true });
  });

  afterEach(() => {
    useTreeClashes.setState({ labels: new Map() });
  });

  it("draws nothing while live collaboration is off, even for a renamed file", () => {
    useSettingsStore.setState({ liveCollaboration: false });
    useTreeClashes.setState({ labels: new Map([["figs/plot (from Bob Smith).png", "label"]]) });
    const { container } = render(<TreeRowClash path="figs/plot (from Bob Smith).png" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("marks a renamed file with a tinted badge whose app tooltip names the other file", async () => {
    const label = "figs/plot.png also has the name plot.png, so this file got a new name on disk.";
    useTreeClashes.setState({ labels: new Map([["figs/plot (from Bob Smith).png", label]]) });
    render(<TreeRowClash path="figs/plot (from Bob Smith).png" />);
    const badge = screen.getByRole("img", { name: label });
    expect(badge).not.toHaveAttribute("title");
    expect(badge.className).toContain("bg-amber-500/15");
    expect(badge.className).not.toMatch(/\b(ring|outline)-/);
    expect(badge.querySelector("svg.lucide-files")).toBeInTheDocument();
    fireEvent.mouseEnter(badge.parentElement as HTMLElement);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(label);
  });

  it("draws nothing for a file that kept its name", () => {
    useTreeClashes.setState({ labels: new Map([["figs/plot (from Bob Smith).png", "label"]]) });
    const { container } = render(<TreeRowClash path="figs/plot.png" />);
    expect(container).toBeEmptyDOMElement();
  });
});
