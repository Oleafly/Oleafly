// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import type { CollabCommentNotSent } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useComments } from "../comments/comments-store";
import { commentsStatus } from "../tests/comment-fixtures";
import { useCollabLiveStore } from "./live-store";

const toasts = vi.hoisted(() => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() }) }));

vi.mock("sonner", () => ({ toast: toasts.toast }));

import { CommentsNotSentBanner, notSentText } from "./CommentsNotSentBanner";
import { CollabBanners } from "./SyncPauseBanner";

const copy = enCollab.comments.notSent;

const written: CollabCommentNotSent[] = [
  {
    fileId: "f1",
    path: "chapters/intro.tex",
    threadId: "t1",
    messageId: "m1",
    at: 1,
    newThread: true,
    edit: false,
    editedAt: null,
    quote: "quick brown",
    body: "Cite the survey here.",
  },
  {
    fileId: "f1",
    path: "chapters/intro.tex",
    threadId: "t1",
    messageId: "m2",
    at: 2,
    newThread: false,
    edit: false,
    editedAt: null,
    quote: "quick brown",
    body: "And the 2019 follow-up.",
  },
  {
    fileId: "f2",
    path: null,
    threadId: "t2",
    messageId: "m3",
    at: 3,
    newThread: true,
    edit: false,
    editedAt: null,
    quote: "",
    body: "On a file that is gone.",
  },
];

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  useFilesStore.setState({ projectId: "paper" });
  useCollabLiveStore.setState({ projectId: "paper", commentsNotSent: null, notSentBannerHidden: false });
});

afterEach(() => {
  useCollabLiveStore.setState({ projectId: null, commentsNotSent: null });
  useFilesStore.setState({ projectId: null });
});

describe("CommentsNotSentBanner", () => {
  it("shows nothing while every comment was sent", () => {
    const { container } = render(<CommentsNotSentBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says inline, without a toast, that the comments were not sent and keeps their text one click away", async () => {
    useCollabLiveStore.setState({ commentsNotSent: written });
    const user = userEvent.setup();
    render(<CommentsNotSentBanner />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(copy.written);
    expect(screen.queryByRole("list", { name: copy.list })).toBeNull();
    expect(toasts.toast).not.toHaveBeenCalled();
    expect(toasts.toast.info).not.toHaveBeenCalled();
    const show = screen.getByRole("button", { name: copy.show });
    expect(show).toHaveAttribute("aria-expanded", "false");
    await user.click(show);
    const list = screen.getByRole("list", { name: copy.list });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("chapters/intro.tex");
    expect(items[0]).toHaveTextContent("quick brown");
    expect(items[0]).toHaveTextContent("Cite the survey here.");
    expect(items[1]).toHaveTextContent("And the 2019 follow-up.");
    expect(items[1]).not.toHaveTextContent("quick brown");
    expect(items[2]).toHaveTextContent("On a file that is gone.");
    await user.click(screen.getByRole("button", { name: copy.hide }));
    expect(screen.queryByRole("list", { name: copy.list })).toBeNull();
  });

  it("copies every comment that was not sent with its file and quoted text", async () => {
    useCollabLiveStore.setState({ commentsNotSent: written });
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CommentsNotSentBanner />);
    await user.click(screen.getByRole("button", { name: copy.copy }));
    expect(writeText).toHaveBeenCalledWith(notSentText(written));
    expect(notSentText(written)).toBe(
      [
        "chapters/intro.tex\n> quick brown\nCite the survey here.",
        "chapters/intro.tex\n> quick brown\nAnd the 2019 follow-up.",
        "On a file that is gone.",
      ].join("\n\n"),
    );
    expect(await screen.findByRole("button", { name: enCommon.actions.copied })).toBeInTheDocument();
  });

  it("says so on the button when the comments could not be copied", async () => {
    useCollabLiveStore.setState({ commentsNotSent: written });
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {
      throw new Error("clipboard blocked");
    });
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CommentsNotSentBanner />);
    await user.click(screen.getByRole("button", { name: copy.copy }));
    expect(await screen.findByRole("button", { name: copy.copyFailed })).toBeInTheDocument();
    expect(toasts.toast.error).not.toHaveBeenCalled();
  });

  it("quotes every line of a quote that spans lines", () => {
    expect(
      notSentText([
        { fileId: "f", path: "a.tex", threadId: "t", messageId: "m", at: 1, newThread: true, edit: false, editedAt: null, quote: "one\ntwo", body: "note" },
      ]),
    ).toBe(
      "a.tex\n> one\n> two\nnote",
    );
  });

  it("says the changes were not sent when nothing written was left out", () => {
    useCollabLiveStore.setState({ commentsNotSent: [] });
    render(<CommentsNotSentBanner />);
    expect(screen.getByRole("status")).toHaveTextContent(copy.changed);
    expect(screen.queryByRole("button", { name: copy.show })).toBeNull();
    expect(screen.queryByRole("button", { name: copy.copy })).toBeNull();
  });

  it("names the server when comments are off server-wide", () => {
    useComments.setState({ status: { ...commentsStatus(), serverAllowed: false } });
    useCollabLiveStore.setState({ commentsNotSent: written });
    const view = render(<CommentsNotSentBanner />);
    expect(screen.getByRole("status")).toHaveTextContent(copy.writtenServer);
    view.unmount();
    useCollabLiveStore.setState({ commentsNotSent: [] });
    render(<CommentsNotSentBanner />);
    expect(screen.getByRole("status")).toHaveTextContent(copy.changedServer);
    useComments.setState({ status: null });
  });

  it("goes away when closed, while the comments stay listed in place", async () => {
    useCollabLiveStore.setState({ commentsNotSent: written });
    const user = userEvent.setup();
    render(<CommentsNotSentBanner />);
    await user.click(screen.getByRole("button", { name: enCommon.actions.close }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(useCollabLiveStore.getState().commentsNotSent).toEqual(written);
  });

  it("belongs to the open project only", () => {
    useCollabLiveStore.setState({ projectId: "other", commentsNotSent: written });
    const { container } = render(<CommentsNotSentBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is one of the collaboration banners", () => {
    useCollabLiveStore.setState({ commentsNotSent: written });
    render(<CollabBanners />);
    expect(screen.getByTestId("collab-comments-not-sent-banner")).toHaveTextContent(copy.written);
  });
});
