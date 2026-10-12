// @vitest-environment jsdom

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { formatDateTime } from "@/lib/intl";
import type { CollabAccessEntry, CollabAccessLogPage } from "@/lib/tauri";
import { useCollabLiveStore } from "../live/live-store";
import { ALICE_ID, BOB, BOB_ID, CAROL, collabError, fill, person, shareInfo } from "../tests/fixtures";
import { useAccessLogSwitches } from "./access-log-store";

const mocks = vi.hoisted(() => ({
  collabAccessLogStatus: vi.fn(),
  collabAccessLogPage: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  collabAccessLogStatus: mocks.collabAccessLogStatus,
  collabAccessLogPage: mocks.collabAccessLogPage,
}));

import { AccessLog } from "./AccessLog";

const copy = enCollab.accessLog;
const title = enCollab.pane.accessLog;
const NOW = Date.now();

function entry(overrides: Partial<CollabAccessEntry> = {}): CollabAccessEntry {
  return {
    id: 1,
    kind: "opened",
    via: null,
    person: person(),
    device_name: "Alice's laptop",
    at: NOW - 60_000,
    last_at: NOW - 60_000,
    times: 1,
    ...overrides,
  };
}

function page(items: CollabAccessEntry[], next: string | null = null): CollabAccessLogPage {
  return { items, next_cursor: next };
}

function view(open = true) {
  const onOpenChange = vi.fn();
  const rendered = render(<AccessLog open={open} onOpenChange={onOpenChange} />);
  return { onOpenChange, ...rendered };
}

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
  useAccessLogSwitches.setState({ byProject: {} });
  mocks.collabAccessLogStatus.mockResolvedValue({ serverAllowed: true, enabled: true });
  mocks.collabAccessLogPage.mockResolvedValue(page([]));
  useCollabLiveStore.setState({
    projectId: "grant",
    share: shareInfo({ role: "owner", account_id: BOB_ID }),
    role: "owner",
    status: { state: "online" },
    members: [],
  });
});

afterEach(() => {
  useCollabLiveStore.setState({ projectId: null, share: null, role: null, status: null, members: [] });
});

describe("AccessLog", () => {
  it("lists who opened, joined and downloaded the project, newest first, with the device and time", async () => {
    mocks.collabAccessLogPage.mockResolvedValue(
      page([
        entry({ id: 4, kind: "downloaded", person: CAROL, device_name: "Lab desktop", at: NOW - 120_000 }),
        entry({ id: 3, kind: "opened", at: NOW - 3_600_000, last_at: NOW - 600_000, times: 4 }),
        entry({ id: 2, kind: "joined", via: "share", person: CAROL, device_name: "Lab desktop" }),
        entry({ id: 1, kind: "joined", via: "link", device_name: "" }),
      ]),
    );
    view();
    const list = await screen.findByRole("list", { name: title });
    expect(mocks.collabAccessLogStatus).toHaveBeenCalledWith("grant");
    expect(mocks.collabAccessLogPage).toHaveBeenCalledWith("grant", null);
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent(fill(copy.downloaded, { name: "Carol Diaz" }));
    expect(rows[0]).toHaveTextContent("Lab desktop");
    expect(rows[0].querySelector("time")).toHaveTextContent("2 minutes ago");
    expect(rows[1]).toHaveTextContent(fill(copy.opened, { name: "Alice Chen" }));
    expect(rows[1].querySelector("time")).toHaveTextContent("1 hour ago");
    expect(rows[1].querySelector("time")).toHaveAttribute(
      "title",
      fill(copy.span, { from: formatDateTime(NOW - 3_600_000), to: formatDateTime(NOW - 600_000) }),
    );
    expect(rows[2]).toHaveTextContent(fill(copy.joinedShare, { name: "Carol Diaz" }));
    expect(rows[3]).toHaveTextContent(fill(copy.joinedLink, { name: "Alice Chen" }));
    expect(rows[3]).toHaveTextContent(copy.unknownDevice);
    expect(screen.queryByRole("button", { name: copy.more })).toBeNull();
  });

  it("loads older entries a page at a time", async () => {
    mocks.collabAccessLogPage
      .mockResolvedValueOnce(page([entry({ id: 9, kind: "downloaded" }), entry({ id: 8 })], "8"))
      .mockResolvedValueOnce(page([entry({ id: 5, kind: "joined", via: "link" })]));
    const user = userEvent.setup();
    view();
    const list = await screen.findByRole("list", { name: title });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: copy.more }));
    expect(mocks.collabAccessLogPage).toHaveBeenLastCalledWith("grant", "8");
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(3));
    expect(within(list).getAllByRole("listitem")[2]).toHaveTextContent(fill(copy.joinedLink, { name: "Alice Chen" }));
    expect(screen.queryByRole("button", { name: copy.more })).toBeNull();
  });

  it("keeps what it has and says why when an older page does not load", async () => {
    mocks.collabAccessLogPage
      .mockResolvedValueOnce(page([entry({ id: 9 })], "9"))
      .mockRejectedValueOnce(collabError("unreachable"));
    const user = userEvent.setup();
    view();
    await screen.findByRole("list", { name: title });
    await user.click(screen.getByRole("button", { name: copy.more }));
    expect(await screen.findByRole("alert")).toHaveTextContent(enCollab.errors.unreachable);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("button", { name: copy.more })).toBeEnabled();
  });

  it("says so in one quiet line when nothing was recorded", async () => {
    view();
    expect(await screen.findByText(copy.empty)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: title })).toBeNull();
  });

  it("offers to try again when the log does not load", async () => {
    mocks.collabAccessLogPage.mockRejectedValueOnce(collabError("unreachable"));
    mocks.collabAccessLogPage.mockResolvedValueOnce(page([entry()]));
    const user = userEvent.setup();
    view();
    expect(await screen.findByText(copy.loadFailed)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /try again|retry/i }));
    expect(await screen.findByRole("list", { name: title })).toBeInTheDocument();
  });

  it("asks for nothing while the section is closed and opens on request", async () => {
    const { onOpenChange } = view(false);
    const toggle = await screen.findByRole("button", { name: title });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(mocks.collabAccessLogPage).not.toHaveBeenCalled();
    await userEvent.setup().click(toggle);
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("stays hidden from everyone but the owner", async () => {
    useCollabLiveStore.setState({ role: "editor", share: shareInfo({ role: "editor", account_id: ALICE_ID }) });
    const { container } = view();
    await act(async () => undefined);
    expect(container).toBeEmptyDOMElement();
    expect(mocks.collabAccessLogStatus).not.toHaveBeenCalled();
    expect(mocks.collabAccessLogPage).not.toHaveBeenCalled();
  });

  it("stays hidden while the log is off or the server does not allow it", async () => {
    for (const status of [
      { serverAllowed: true, enabled: false },
      { serverAllowed: false, enabled: true },
    ]) {
      useAccessLogSwitches.setState({ byProject: {} });
      mocks.collabAccessLogStatus.mockResolvedValue(status);
      const { container, unmount } = view();
      await waitFor(() => expect(mocks.collabAccessLogStatus).toHaveBeenCalled());
      await act(async () => undefined);
      expect(container).toBeEmptyDOMElement();
      expect(mocks.collabAccessLogPage).not.toHaveBeenCalled();
      unmount();
      vi.clearAllMocks();
    }
  });

  it("appears as soon as the owner turns the log on in the share dialog", async () => {
    mocks.collabAccessLogStatus.mockResolvedValue({ serverAllowed: true, enabled: false });
    mocks.collabAccessLogPage.mockResolvedValue(page([entry({ person: BOB })]));
    const { container } = view();
    await waitFor(() => expect(mocks.collabAccessLogStatus).toHaveBeenCalled());
    await act(async () => undefined);
    expect(container).toBeEmptyDOMElement();
    act(() => useAccessLogSwitches.getState().set("grant", { serverAllowed: true, enabled: true }));
    const list = await screen.findByRole("list", { name: title });
    expect(within(list).getByRole("listitem")).toHaveTextContent(fill(copy.opened, { name: "Bob Smith" }));
  });

  it("drops a page that arrives after the project changed", async () => {
    let answer: (value: CollabAccessLogPage) => void = () => undefined;
    mocks.collabAccessLogPage.mockImplementationOnce(
      () => new Promise<CollabAccessLogPage>((resolve) => (answer = resolve)),
    );
    view();
    await waitFor(() => expect(mocks.collabAccessLogPage).toHaveBeenCalledWith("grant", null));
    act(() => useCollabLiveStore.setState({ projectId: "thesis" }));
    await waitFor(() => expect(mocks.collabAccessLogPage).toHaveBeenCalledWith("thesis", null));
    await act(async () => answer(page([entry()])));
    expect(await screen.findByText(copy.empty)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: title })).toBeNull();
  });
});
