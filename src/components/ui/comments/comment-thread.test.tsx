// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { type CommentConfirmProps, type CommentKit, CommentKitProvider } from "./comment-kit";
import { CommentScrollArea } from "./comment-arrivals";
import { CommentComposer } from "./comment-composer";
import { type CommentPresence, type CommentPresenceFeed, createPresenceFeed, presenceText } from "./comment-presence";
import { CommentQuote } from "./comment-quote";
import { chatGroups } from "./comment-bubble";
import type { CommentEntry } from "./comment-entry";
import { CommentItem } from "./comment-item";
import { commentCardClass, CommentThread, type CommentThreadActions, type CommentThreadModel } from "./comment-thread";

const SELF = "alice";
const NO = "No";
const MESSAGE = "Message";

const LABELS: CommentKit["labels"] = {
  showMore: "Show more",
  showLess: "Show less",
  outdated: "Outdated",
  mentionList: "People to mention",
  hereNow: "here now",
  cancel: "Cancel",
  sending: "Sending",
  enter: "Enter",
  notSent: "Not sent.",
  retry: "Retry",
  format: {
    bold: "Bold",
    italic: "Italic",
    strike: "Strikethrough",
    code: "Inline code",
    list: "Bulleted list",
    mention: "Mention someone",
  },
  edited: "edited",
  deleted: "This comment was deleted.",
  edit: "Edit",
  editLabel: "Edit comment",
  delete: "Delete",
  save: "Save",
  reply: "Reply",
  replyLabel: "Reply to this thread",
  replyPlaceholder: "Write a reply",
  replies: (count) => `${count} ${count === 1 ? "reply" : "replies"}`,
  hideReplies: "Hide replies",
  lastReply: (time) => `last reply ${time}`,
  messageActions: "More actions for this comment",
  resolve: "Resolve",
  reopen: "Reopen",
  send: "Send",
  copyLink: "Copy link",
  copied: "Copied",
  addReaction: "Add reaction",
  you: "you",
  reactWith: (emoji) => `React with ${emoji}`,
  reactedBy: (names, emoji) => `${names} reacted with ${emoji}`,
  deleteMessageConfirm: { title: "Delete this comment?", description: "It's gone for everyone." },
  newBadge: "New",
  waiting: "Waiting to send",
  copyText: "Copy text",
  discard: "Discard",
  removed: "Removed by a moderator",
  remove: "Remove…",
  removeConfirm: { title: "Remove this comment?", description: "Replies stay." },
  replying: {
    one: (name) => `${name} is replying`,
    two: (first, second) => `${first} and ${second} are replying`,
    many: (count) => `${count} people are replying`,
  },
};

function Confirm({ open, title, confirmLabel, onConfirm, onCancel }: Readonly<CommentConfirmProps>) {
  if (!open) return null;
  return (
    <div role="alertdialog" aria-label={title}>
      <button type="button" onClick={onConfirm}>
        {confirmLabel}
      </button>
      <button type="button" onClick={onCancel}>
        {NO}
      </button>
    </div>
  );
}

function kit(labels: Partial<CommentKit["labels"]> = {}): CommentKit {
  return {
    labels: { ...LABELS, ...labels },
    now: 10 * 60_000,
    relative: (at, now) => `${Math.round((now - at) / 60_000)} min ago`,
    exact: (at) => new Date(at).toISOString(),
    members: [
      { accountId: "alice", displayName: "Alice Chen" },
      { accountId: "bob", displayName: "Bob Smith" },
    ],
    self: SELF,
    hue: () => 200,
    describeError: () => "It failed.",
    Confirm,
    nameOf: (accountId) => (accountId === "bob" ? "Bob Smith" : "Alice Chen"),
    listNames: (names) => names.join(" and "),
  };
}

function entry(
  id: string,
  author: string,
  name: string,
  body: string,
  at = 0,
  reactions: CommentEntry["reactions"] = [],
): CommentEntry {
  return { id, author: { id: author, name, verified: true }, at, editedAt: null, deleted: false, body, mentions: [], reactions };
}

function model(messages: CommentEntry[], patch: Partial<CommentThreadModel> = {}): CommentThreadModel {
  return {
    id: "t1",
    label: "Comment from Bob Smith",
    quote: "saturating doses",
    quoteState: "anchored",
    resolution: null,
    messages,
    deletable: false,
    ...patch,
  };
}

function actions(): CommentThreadActions {
  const done = vi.fn(async () => undefined);
  return {
    edit: done,
    remove: done,
    react: vi.fn(async () => undefined),
    reply: vi.fn(async () => undefined),
    resolve: vi.fn(async () => undefined),
    reopen: done,
    removeThread: done,
  };
}

function replyingFeed(replying: Record<string, CommentPresence[]>): CommentPresenceFeed {
  const feed = createPresenceFeed();
  feed.publish({ replying: new Map(Object.entries(replying)), chat: [] });
  return feed;
}

function renderWith(node: ReactNode, value = kit()) {
  return render(<CommentKitProvider value={value}>{node}</CommentKitProvider>);
}

describe("comment thread", () => {
  it("keeps one reply open and folds two or more behind a count with the last reply's time", async () => {
    const user = userEvent.setup();
    const thread = model([
      entry("m1", "bob", "Bob Smith", "Root"),
      entry("m2", "alice", "Alice Chen", "First reply", 2 * 60_000),
      entry("m3", "bob", "Bob Smith", "Second reply", 6 * 60_000),
    ]);
    renderWith(<CommentThread thread={thread} actions={actions()} canWrite />);
    const toggle = screen.getByRole("button", { name: /2 replies/u });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("last reply 4 min ago");
    expect(screen.queryByText("Second reply")).toBeNull();
    await user.click(toggle);
    expect(screen.getByRole("list", { name: "2 replies" })).toHaveTextContent("Second reply");
    expect(screen.getByRole("button", { name: /Hide replies/u })).toHaveAttribute("aria-expanded", "true");
  });

  it("answers someone else with a mention and yourself without one, and sends through the host", async () => {
    const user = userEvent.setup();
    const given = actions();
    const thread = model([entry("m1", "bob", "Bob Smith", "Root"), entry("m2", "alice", "Alice Chen", "Mine")]);
    renderWith(<CommentThread thread={thread} actions={given} canWrite />);
    await user.click(screen.getAllByRole("button", { name: "Reply" })[1]);
    expect(screen.getByRole("textbox", { name: "Reply to this thread" })).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getAllByRole("button", { name: "Reply" })[0]);
    const field = screen.getByRole("textbox", { name: "Reply to this thread" });
    expect(field).toHaveValue("@Bob Smith ");
    expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
    await user.type(field, "done");
    fireEvent.keyDown(field, { key: "Enter", metaKey: true });
    expect(given.reply).toHaveBeenCalledWith("@Bob Smith done");
  });

  it("gives only your own messages a menu, without Delete thread when the host offers none", async () => {
    const thread = model([entry("m1", "alice", "Alice Chen", "Mine"), entry("m2", "bob", "Bob Smith", "Theirs")], {
      deletable: true,
    });
    renderWith(<CommentThread thread={thread} actions={actions()} canWrite />);
    const menus = screen.getAllByRole("button", { name: LABELS.messageActions });
    expect(menus).toHaveLength(1);
    expect(menus[0].closest("li")).toHaveTextContent("Mine");
    fireEvent.keyDown(menus[0], { key: "Enter" });
    expect(await screen.findByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /thread/u })).toBeNull();
  });

  it("folds a resolved thread to its summary and opens it read only", async () => {
    const user = userEvent.setup();
    const given = actions();
    const thread = model([entry("m1", "bob", "Bob Smith", "Root")], { resolution: "Resolved by Bob Smith" });
    renderWith(<CommentThread thread={thread} actions={given} canWrite />);
    const article = screen.getByRole("article", { name: "Comment from Bob Smith" });
    expect(article).toHaveTextContent("saturating doses · Root");
    await user.click(within(article).getByRole("button", { name: /Resolved by Bob Smith/u }));
    expect(within(article).getByText("Root")).toBeInTheDocument();
    expect(within(article).queryByRole("button", { name: "Reply" })).toBeNull();
    expect(within(article).queryByRole("button", { name: "Resolve" })).toBeNull();
    await user.click(within(article).getByRole("button", { name: "Reopen" }));
    expect(given.reopen).toHaveBeenCalledTimes(1);
  });

  it("previews a resolved thread's opening message as written when the host turns Markdown off", () => {
    const thread = model([entry("m1", "bob", "Bob Smith", "a **b** c")], { resolution: "Resolved by Bob Smith" });
    const { unmount } = renderWith(<CommentThread thread={thread} actions={actions()} canWrite />, { ...kit(), markdown: false });
    expect(screen.getByRole("article", { name: "Comment from Bob Smith" })).toHaveTextContent("saturating doses · a **b** c");
    unmount();
    renderWith(<CommentThread thread={thread} actions={actions()} canWrite />);
    expect(screen.getByRole("article", { name: "Comment from Bob Smith" })).toHaveTextContent("saturating doses · a b c");
  });

  it("shows nothing writable to someone who can only read", () => {
    const thread = model([entry("m1", "alice", "Alice Chen", "Mine")]);
    renderWith(<CommentThread thread={thread} actions={actions()} canWrite={false} />);
    expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Resolve" })).toBeNull();
    expect(screen.queryByRole("button", { name: LABELS.messageActions })).toBeNull();
  });
});

describe("comment quote", () => {
  it("tints an anchored quote with the comment tokens and greys outdated and detached ones", () => {
    const { rerender } = render(<CommentQuote quote="doses" labels={LABELS} />);
    const quote = () => document.querySelector('[data-slot="comment-quote"]') as HTMLElement;
    expect(quote()).toHaveClass("bg-comment-highlight", "text-comment-ink");
    rerender(<CommentQuote quote="doses" labels={LABELS} active />);
    expect(quote()).toHaveClass("bg-comment-active");
    rerender(<CommentQuote quote="doses" labels={LABELS} state="outdated" />);
    expect(quote()).toHaveClass("bg-muted");
    expect(quote()).toHaveTextContent("Outdated");
    rerender(<CommentQuote quote="doses" labels={LABELS} state="detached" />);
    expect(quote().querySelector("[data-quote-text]")).toHaveClass("line-through");
    expect(quote()).toHaveTextContent("Outdated");
    expect(quote().className).not.toMatch(/amber|yellow/u);
  });
});

describe("rich bodies and the menu", () => {
  it("renders the Markdown subset without raw HTML", () => {
    const thread = model([entry("m1", "bob", "Bob Smith", "Use **median** and `mean`\n- <b>one</b>\n- _two_")]);
    renderWith(<CommentThread thread={thread} actions={actions()} canWrite />);
    const body = document.querySelector("[data-comment-body]") as HTMLElement;
    expect(body.querySelector("strong")).toHaveTextContent("median");
    expect(body.querySelector("code")).toHaveTextContent("mean");
    expect(body.querySelectorAll("ul > li")).toHaveLength(2);
    expect(body.querySelector("b")).toBeNull();
    expect(body).toHaveTextContent("<b>one</b>");
  });

  it("offers Copy link and Resolve thread on the first message and shows Delete in red", async () => {
    const copyText = vi.fn(async () => undefined);
    const given = actions();
    const thread = model([entry("m1", "alice", "Alice Chen", "Mine")], { link: "oleafly://open?thread=t1" });
    renderWith(<CommentThread thread={thread} actions={given} canWrite />, { ...kit(), copyText });
    fireEvent.keyDown(screen.getByRole("button", { name: LABELS.messageActions }), { key: "Enter" });
    const items = (await screen.findAllByRole("menuitem")).map((item) => item.textContent);
    expect(items).toEqual(["Edit", "Copy link", "Resolve", "Delete"]);
    expect(screen.getByRole("menuitem", { name: "Delete" }).className).toMatch(/text-destructive/u);
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith("oleafly://open?thread=t1"));
    expect(await screen.findByRole("status")).toHaveTextContent("Copied");
  });
});

describe("reactions", () => {
  const withReactions = () => ({ ...kit(), reactions: { quick: ["👍", "🎉"] } });

  it("shows pills with who reacted and marks your own", () => {
    const thread = model([entry("m1", "bob", "Bob Smith", "Root", 0, [{ emoji: "👍", by: ["bob", SELF] }])]);
    renderWith(<CommentThread thread={thread} actions={actions()} canWrite />, withReactions());
    const pill = screen.getByRole("button", { name: "Bob Smith and you reacted with 👍" });
    expect(pill).toHaveAttribute("aria-pressed", "true");
    expect(pill).toHaveTextContent("2");
    expect(pill.className).toMatch(/bg-primary\/10/u);
  });

  it("adds a reaction at once from the picker and takes it back when the server refuses", async () => {
    const given = actions();
    let refuse: (reason: unknown) => void = () => undefined;
    given.react = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          refuse = reject;
        }),
    );
    const thread = model([entry("m1", "bob", "Bob Smith", "Root")]);
    renderWith(<CommentThread thread={thread} actions={given} canWrite />, withReactions());
    fireEvent.click(screen.getByRole("button", { name: "Add reaction" }));
    fireEvent.click(await screen.findByRole("button", { name: "React with 🎉" }));
    expect(given.react).toHaveBeenCalledWith("m1", "🎉", true);
    expect(screen.getByRole("button", { name: "you reacted with 🎉" })).toHaveAttribute("aria-pressed", "true");
    await act(async () => refuse(new Error("no")));
    expect(screen.queryByRole("button", { name: "you reacted with 🎉" })).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("It failed.");
  });

  it("shows counts but no way to react to someone who can only read", () => {
    const thread = model([entry("m1", "bob", "Bob Smith", "Root", 0, [{ emoji: "👀", by: ["bob"] }])]);
    renderWith(<CommentThread thread={thread} actions={actions()} canWrite={false} />, withReactions());
    expect(screen.getByRole("img", { name: "Bob Smith reacted with 👀" })).toHaveTextContent("1");
    expect(screen.queryByRole("button", { name: "Add reaction" })).toBeNull();
  });
});

describe("comment composer", () => {
  function compose(onSubmit: (body: string) => Promise<void>, canRetry?: (error: unknown) => boolean) {
    renderWith(<CommentComposer label={MESSAGE} submitLabel={LABELS.send} onSubmit={onSubmit} />, {
      ...kit(),
      describeError: () => "The server didn't answer.",
      canRetry,
      members: [],
    });
    return screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
  }

  it("wraps the selection from the format bar and keeps the send button inside the box", async () => {
    const user = userEvent.setup();
    const field = compose(vi.fn(async () => undefined));
    await user.type(field, "make this bold");
    field.setSelectionRange(10, 14);
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(field).toHaveValue("make this **bold**");
    fireEvent.click(screen.getByRole("button", { name: "Bulleted list" }));
    expect(field.value.startsWith("- ")).toBe(true);
    const send = screen.getByRole("button", { name: "Send" });
    expect(send.closest("[data-composer-state]")).not.toBeNull();
    expect(send.className).toMatch(/rounded-full/u);
  });

  it("puts the mention button alone at the start of the row when Markdown is off, with no divider before it", () => {
    const withMention = (markdown: boolean) =>
      renderWith(<CommentComposer label={MESSAGE} submitLabel={LABELS.send} onSubmit={vi.fn(async () => undefined)} mentionButton />, {
        ...kit(),
        markdown,
      });
    const plain = withMention(false);
    expect(screen.getByRole("button", { name: "Mention someone" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bold" })).toBeNull();
    expect(plain.container.querySelectorAll("span[aria-hidden].w-px")).toHaveLength(0);
    plain.unmount();
    const formatted = withMention(true);
    expect(screen.getByRole("button", { name: "Bold" })).toBeInTheDocument();
    expect(formatted.container.querySelectorAll("span[aria-hidden].w-px")).toHaveLength(1);
  });

  it("says a comment was not sent and retries when retrying can help", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(body: string) => Promise<void>>().mockRejectedValueOnce(new Error("down")).mockResolvedValue(undefined);
    const field = compose(onSubmit, () => true);
    await user.type(field, "Hello");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not sent.The server didn't answer.");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(field).toHaveValue("");
  });
});

describe("live comment states", () => {
  const ROOT = entry("m1", "bob", "Bob Smith", "Median or mean?", 60_000);

  it("shows a deleted comment as a grey trash row with no name or time, and a moderator removal as such", () => {
    const deleted = { ...entry("m1", "bob", "Bob Smith", ""), deleted: true };
    const removed = { ...entry("m2", "bob", "Bob Smith", ""), deleted: true, removed: true };
    renderWith(
      <CommentThread
        thread={model([deleted, entry("m3", "alice", "Alice Chen", "I have the traces", 2 * 60_000), removed])}
        actions={actions()}
        canWrite
        selected
      />,
    );
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("This comment was deleted.");
    expect(rows[0]).not.toHaveTextContent("Bob Smith");
    expect(rows[0].querySelector("time")).toBeNull();
    expect(screen.getByText("I have the traces")).toBeInTheDocument();
    expect(screen.getByText("Removed by a moderator")).toBeInTheDocument();
  });

  it("lets a moderator remove someone else's comment after a confirm, and never their own", async () => {
    const user = userEvent.setup();
    const moderate = vi.fn(async () => undefined);
    renderWith(
      <CommentThread
        thread={model([ROOT, entry("m2", "alice", "Alice Chen", "Mine", 2 * 60_000)])}
        actions={{ ...actions(), moderate }}
        canWrite
      />,
      { ...kit(), moderate: true },
    );
    const own = screen.getByText("Mine").closest("[data-comment-entry]") as HTMLElement;
    fireEvent.pointerDown(within(own).getByRole("button", { name: LABELS.messageActions }), { button: 0, ctrlKey: false });
    expect(screen.queryByRole("menuitem", { name: "Remove…" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    const other = screen.getByText("Median or mean?").closest("[data-comment-entry]") as HTMLElement;
    fireEvent.pointerDown(within(other).getByRole("button", { name: LABELS.messageActions }), { button: 0, ctrlKey: false });
    await user.click(screen.getByRole("menuitem", { name: "Remove…" }));
    await user.click(within(screen.getByRole("alertdialog", { name: "Remove this comment?" })).getByRole("button", { name: "Remove…" }));
    expect(moderate).toHaveBeenCalledWith("m1");
  });

  it("marks a comment that waits to send with a clock and a muted body, and nothing to act on", () => {
    renderWith(
      <CommentThread
        thread={model([ROOT, { ...entry("q1", "alice", "Alice Chen", "Keep the y-axis", 3 * 60_000), delivery: { state: "waiting" } }])}
        actions={actions()}
        canWrite
      />,
    );
    const row = screen.getByText("Keep the y-axis").closest("[data-comment-entry]") as HTMLElement;
    expect(row).toHaveAttribute("data-delivery", "waiting");
    expect(row).toHaveTextContent("Waiting to send");
    expect(row.querySelector("time")).toBeNull();
    expect(screen.getByText("Keep the y-axis").closest("[data-comment-body]")).toHaveClass("text-muted-foreground");
    expect(within(row).queryByRole("button", { name: LABELS.messageActions })).toBeNull();
  });

  it("keeps a refused comment in the thread with the reason, Copy text and Discard, and Retry only when it can work", async () => {
    const user = userEvent.setup();
    const discard = vi.fn();
    const retry = vi.fn();
    const copyText = vi.fn(async () => undefined);
    const failed = (id: string, canRetry: boolean): CommentEntry => ({
      ...entry(id, "alice", "Alice Chen", "Move Figure 2 up?", 3 * 60_000),
      delivery: { state: "failed", reason: "Comments are turned off for this project.", discard, retry: canRetry ? retry : undefined },
    });
    renderWith(<CommentThread thread={model([ROOT, failed("x1", false)])} actions={actions()} canWrite />, { ...kit(), copyText });
    const row = screen.getByText("Move Figure 2 up?").closest("[data-comment-entry]") as HTMLElement;
    expect(row).toHaveTextContent("Not sent. Comments are turned off for this project.");
    expect(within(row).queryByRole("button", { name: "Retry" })).toBeNull();
    await user.click(within(row).getByRole("button", { name: "Copy text" }));
    expect(copyText).toHaveBeenCalledWith("Move Figure 2 up?");
    await user.click(within(row).getByRole("button", { name: "Discard" }));
    expect(discard).toHaveBeenCalled();
  });

  it("opens a resolved thread fully read only: static pills, no reaction picker and no Delete thread", () => {
    const reacted = entry("m1", "alice", "Alice Chen", "Root", 0, [{ emoji: "👍", by: ["bob"] }]);
    renderWith(
      <CommentThread
        thread={model([reacted], { resolution: "Resolved by Bob Smith", deletable: true })}
        actions={actions()}
        canWrite
        selected
      />,
      { ...kit({ deleteThread: "Delete thread" }), reactions: { quick: ["👍"] } },
    );
    expect(screen.getByRole("img", { name: "Bob Smith reacted with 👍" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add reaction" })).toBeNull();
    expect(screen.queryByRole("button", { name: LABELS.messageActions })).toBeNull();
    expect(document.querySelector("svg.text-success")).not.toBeNull();
  });

  it.each([
    [["Daniel Hart"], "Daniel Hart is replying"],
    [["Daniel Hart", "Nina Takeda"], "Daniel and Nina are replying"],
    [["Daniel Hart", "Nina Takeda", "Sofia Marín"], "3 people are replying"],
  ])("says who is replying under the thread: %j", (names, text) => {
    const people = names.map((name, index) => ({ id: `p${index}`, name }));
    renderWith(<CommentThread thread={model([ROOT])} actions={actions()} canWrite />, {
      ...kit(),
      presence: replyingFeed({ t1: people }),
    });
    expect(screen.getByRole("status")).toHaveTextContent(text);
  });

  it("shows the edit time after a dot", () => {
    renderWith(<CommentThread thread={model([{ ...ROOT, editedAt: 5 * 60_000 }])} actions={actions()} canWrite />);
    expect(screen.getByText("· edited")).toBeInTheDocument();
  });

  it("tags a count with +1 when someone else's reaction raises it, not when you react", () => {
    vi.useFakeTimers();
    try {
      const render1 = (by: string[]) => (
        <CommentKitProvider value={{ ...kit(), reactions: { quick: ["👍"] } }}>
          <CommentThread thread={model([{ ...ROOT, reactions: [{ emoji: "👍", by }] }])} actions={actions()} canWrite />
        </CommentKitProvider>
      );
      const view = render(render1(["carol"]));
      expect(document.querySelector("[data-reaction-bump]")).toBeNull();
      view.rerender(render1(["carol", "bob"]));
      expect(document.querySelector("[data-reaction-bump]")).toHaveTextContent("+1");
      act(() => {
        vi.advanceTimersByTime(3_000);
      });
      expect(document.querySelector("[data-reaction-bump]")).toBeNull();
      view.rerender(render1(["carol", "bob", SELF]));
      expect(document.querySelector("[data-reaction-bump]")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps each +N for its own time, adds up a second person, and fades it on the pill's corner", () => {
    vi.useFakeTimers();
    try {
      const shown = (reactions: { emoji: string; by: string[] }[]) => (
        <CommentKitProvider value={{ ...kit(), reactions: { quick: ["👍", "🎉"] } }}>
          <CommentThread thread={model([{ ...ROOT, reactions }])} actions={actions()} canWrite />
        </CommentKitProvider>
      );
      const bump = (emoji: string) =>
        screen.getByRole("button", { name: new RegExp(`reacted with ${emoji}`, "u") }).querySelector("[data-reaction-bump]");
      const view = render(shown([{ emoji: "👍", by: ["carol"] }, { emoji: "🎉", by: ["carol"] }]));
      view.rerender(shown([{ emoji: "👍", by: ["carol", "bob"] }, { emoji: "🎉", by: ["carol"] }]));
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      view.rerender(shown([{ emoji: "👍", by: ["carol", "bob", "dana"] }, { emoji: "🎉", by: ["carol", "bob"] }]));
      expect(bump("👍")).toHaveTextContent("+2");
      expect(bump("🎉")).toHaveTextContent("+1");
      expect(bump("👍")).toHaveClass("absolute", "motion-safe:fade-out");
      act(() => {
        vi.advanceTimersByTime(2_000);
      });
      expect(bump("👍")).toHaveTextContent("+2");
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(bump("👍")).toBeNull();
      expect(bump("🎉")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets each emoji's +N run out on its own clock, so a bump on another emoji never stretches it", () => {
    vi.useFakeTimers();
    try {
      const shown = (reactions: { emoji: string; by: string[] }[]) => (
        <CommentKitProvider value={{ ...kit(), reactions: { quick: ["👍", "🎉"] } }}>
          <CommentThread thread={model([{ ...ROOT, reactions }])} actions={actions()} canWrite />
        </CommentKitProvider>
      );
      const bump = (emoji: string) =>
        screen.getByRole("button", { name: new RegExp(`reacted with ${emoji}`, "u") }).querySelector("[data-reaction-bump]");
      const view = render(shown([{ emoji: "👍", by: ["carol"] }, { emoji: "🎉", by: ["carol"] }]));
      view.rerender(shown([{ emoji: "👍", by: ["carol", "ana"] }, { emoji: "🎉", by: ["carol"] }]));
      act(() => {
        vi.advanceTimersByTime(2_000);
      });
      view.rerender(shown([{ emoji: "👍", by: ["carol", "ana"] }, { emoji: "🎉", by: ["carol", "bob"] }]));
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(bump("👍")).toBeNull();
      expect(bump("🎉")).toHaveTextContent("+1");
      act(() => {
        vi.advanceTimersByTime(400);
      });
      view.rerender(shown([{ emoji: "👍", by: ["carol", "ana", "dana"] }, { emoji: "🎉", by: ["carol", "bob"] }]));
      expect(bump("👍")).toHaveTextContent("+1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts one person once when they take a reaction back and add it again within the +N's time", () => {
    vi.useFakeTimers();
    try {
      const shown = (by: string[]) => (
        <CommentKitProvider value={{ ...kit(), reactions: { quick: ["👍"] } }}>
          <CommentThread thread={model([{ ...ROOT, reactions: [{ emoji: "👍", by }] }])} actions={actions()} canWrite />
        </CommentKitProvider>
      );
      const view = render(shown(["carol"]));
      view.rerender(shown(["carol", "bob"]));
      act(() => {
        vi.advanceTimersByTime(500);
      });
      view.rerender(shown(["carol"]));
      expect(document.querySelector("[data-reaction-bump]")).toBeNull();
      act(() => {
        vi.advanceTimersByTime(500);
      });
      view.rerender(shown(["carol", "bob"]));
      expect(document.querySelector("[data-reaction-bump]")).toHaveTextContent("+1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("fills the Outdated pill a step darker than the chip it sits on", () => {
    renderWith(<CommentQuote quote="saturating doses" labels={LABELS} state="detached" />);
    const pill = screen.getByText("Outdated");
    expect(pill).toHaveClass("bg-foreground/5", "text-foreground/70");
    expect(pill).not.toHaveClass("bg-muted");
  });

  it("puts the Outdated pill on a quote whose text was removed too", () => {
    renderWith(<CommentQuote quote="saturating doses" labels={LABELS} state="detached" />);
    expect(screen.getByText("Outdated")).toBeInTheDocument();
  });
});

describe("mention picker", () => {
  it("labels each person with their role and marks the people here now", async () => {
    const user = userEvent.setup();
    renderWith(<CommentComposer label={MESSAGE} submitLabel="Send" onSubmit={vi.fn(async () => undefined)} />, {
      ...kit(),
      describeError: () => "x",
      members: [
        { accountId: "daniel", displayName: "Daniel Hart", role: "Editor", here: true },
        { accountId: "dana", displayName: "Dana Abiodun", role: "Reviewer" },
      ],
    });
    await user.type(screen.getByRole("textbox", { name: MESSAGE }), "Check this @da");
    const options = within(screen.getByRole("listbox", { name: "People to mention" })).getAllByRole("option");
    expect(options.map((option) => option.textContent?.slice(1))).toEqual(["Daniel HartEditor · here now", "Dana AbiodunReviewer"]);
    expect(options[0].querySelector("[data-here]")).not.toBeNull();
  });
});

describe("typing signal", () => {
  it("tells the host while the box has text, refreshes while typing, and stops on idle, blur or empty", () => {
    vi.useFakeTimers();
    try {
      const onActivity = vi.fn();
      renderWith(<CommentComposer label={MESSAGE} submitLabel="Send" onSubmit={vi.fn(async () => undefined)} onActivity={onActivity} />, {
        ...kit(),
        describeError: () => "x",
        members: [],
      });
      const field = screen.getByRole("textbox", { name: MESSAGE });
      fireEvent.change(field, { target: { value: "H" } });
      fireEvent.change(field, { target: { value: "He" } });
      expect(onActivity.mock.calls).toEqual([[true]]);
      act(() => {
        vi.advanceTimersByTime(2_500);
      });
      fireEvent.change(field, { target: { value: "Hel" } });
      expect(onActivity.mock.calls).toEqual([[true], [true]]);
      act(() => {
        vi.advanceTimersByTime(6_000);
      });
      expect(onActivity.mock.calls.at(-1)).toEqual([false]);
      fireEvent.change(field, { target: { value: "Hell" } });
      expect(onActivity.mock.calls.at(-1)).toEqual([true]);
      fireEvent.blur(field);
      expect(onActivity.mock.calls.at(-1)).toEqual([false]);
      fireEvent.change(field, { target: { value: "Hello" } });
      fireEvent.change(field, { target: { value: "" } });
      expect(onActivity.mock.calls.at(-1)).toEqual([false]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("resolve button", () => {
  it("sits inside the quote chip and only shows on hover, keyboard focus or selection", () => {
    const { rerender } = renderWith(<CommentThread thread={model([entry("m1", "bob", "Bob Smith", "Root")])} actions={actions()} canWrite />);
    const resolve = screen.getByRole("button", { name: LABELS.resolve });
    expect(resolve.closest('[data-slot="comment-quote"]')).not.toBeNull();
    expect(resolve).toHaveClass("opacity-0", "group-hover/thread:opacity-100", "group-has-[:focus-visible]/thread:opacity-100");
    expect(resolve.className).not.toMatch(/focus-within/u);
    expect(resolve.closest("article")).toHaveClass("group/thread", "bg-background");
    rerender(
      <CommentKitProvider value={kit()}>
        <CommentThread thread={model([entry("m1", "bob", "Bob Smith", "Root")])} actions={actions()} canWrite selected />
      </CommentKitProvider>,
    );
    expect(screen.getByRole("button", { name: LABELS.resolve })).toHaveClass("opacity-100");
    expect(screen.getByRole("article")).toHaveClass("border-ring");
  });

  it("goes to the first message's header when the thread shows no quote", () => {
    renderWith(<CommentThread thread={model([entry("m1", "bob", "Bob Smith", "Root")])} actions={actions()} canWrite embedded />);
    const resolve = screen.getByRole("button", { name: LABELS.resolve });
    expect(resolve.closest('[data-slot="comment-quote"]')).toBeNull();
    expect(resolve.closest('[data-comment-entry="m1"]')).not.toBeNull();
  });

  it("keeps Resolve on a thread without a quote while its first message is deleted or being edited", async () => {
    const user = userEvent.setup();
    const deleted = { ...entry("m1", "bob", "Bob Smith", ""), deleted: true };
    const { unmount } = renderWith(<CommentThread thread={model([deleted])} actions={actions()} canWrite embedded />);
    expect(screen.getByRole("button", { name: LABELS.resolve }).closest('[data-comment-entry="m1"]')).not.toBeNull();
    unmount();
    renderWith(<CommentThread thread={model([entry("m1", SELF, "Alice Chen", "Mine")])} actions={actions()} canWrite embedded />);
    await user.click(screen.getByRole("button", { name: LABELS.messageActions }));
    await user.click(screen.getByRole("menuitem", { name: LABELS.edit }));
    expect(screen.getByRole("textbox", { name: LABELS.editLabel })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: LABELS.resolve })).toBeInTheDocument();
  });
});

describe("review fixes", () => {
  it("keeps the unverified marker on a deleted row whose deletion couldn't be verified", () => {
    const forged: CommentEntry = { ...entry("m1", "bob", "Couldn't verify who wrote this", ""), deleted: true, author: { id: "bob", name: "Couldn't verify who wrote this", verified: false } };
    renderWith(<CommentThread thread={model([forged])} actions={actions()} canWrite />);
    const row = document.querySelector('[data-comment-entry="m1"]') as HTMLElement;
    expect(row).toHaveTextContent("This comment was deleted.");
    expect(row).toHaveTextContent("Couldn't verify who wrote this");
  });

  it("offers no Remove inside a resolved thread, and confirms a removal with a plain Remove", async () => {
    const user = userEvent.setup();
    const resolvedKit = { ...kit({ removeConfirm: { title: "Remove this comment?", description: "Replies stay.", confirm: "Remove" } }), moderate: true };
    const { unmount } = renderWith(
      <CommentThread thread={model([entry("m1", "bob", "Bob Smith", "Root")], { resolution: "Resolved by Bob" })} actions={{ ...actions(), moderate: vi.fn(async () => undefined) }} canWrite selected />,
      resolvedKit,
    );
    expect(screen.queryByRole("button", { name: LABELS.messageActions })).toBeNull();
    unmount();
    renderWith(<CommentThread thread={model([entry("m1", "bob", "Bob Smith", "Root")])} actions={{ ...actions(), moderate: vi.fn(async () => undefined) }} canWrite />, resolvedKit);
    fireEvent.pointerDown(screen.getByRole("button", { name: LABELS.messageActions }), { button: 0, ctrlKey: false });
    await user.click(screen.getByRole("menuitem", { name: "Remove…" }));
    expect(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("draws an unsent quote muted, without the strike or the Outdated pill", () => {
    renderWith(<CommentQuote quote="Figure 2" labels={LABELS} state="pending" />);
    expect(document.querySelector("[data-quote-text]")).not.toHaveClass("line-through");
    expect(screen.queryByText("Outdated")).toBeNull();
  });

  it("names two people by their first names, as the board does", () => {
    renderWith(<CommentThread thread={model([entry("m1", "bob", "Bob Smith", "Root")])} actions={actions()} canWrite />, {
      ...kit(),
      presence: replyingFeed({
        t1: [
          { id: "a", name: "Daniel Hart" },
          { id: "b", name: "Nina Takeda" },
        ],
      }),
    });
    expect(screen.getByRole("status")).toHaveTextContent("Daniel and Nina are replying");
  });

  it("uses full names when two people share a first name, and skips a title", () => {
    const labels = { one: (name: string) => `${name} is replying`, two: (a: string, b: string) => `${a} and ${b} are replying`, many: (n: number) => `${n} people` };
    expect(presenceText(labels, ["Daniel Hart", "Daniel Kim"])).toBe("Daniel Hart and Daniel Kim are replying");
    expect(presenceText(labels, ["Dr. Ana Ruiz", "Nina Takeda"])).toBe("Ana and Nina are replying");
  });

  it("keeps an empty send button grey when it gets keyboard focus", () => {
    renderWith(<CommentComposer label={MESSAGE} submitLabel="Send" onSubmit={vi.fn(async () => undefined)} />);
    expect(screen.getByRole("button", { name: "Send" })).toHaveClass("focus-visible:bg-muted");
  });

  it("opens folded replies when a new one arrives in them", () => {
    const replies = [entry("r1", "alice", "Alice Chen", "One", 60_000), entry("r2", "bob", "Bob Smith", "Two", 120_000)];
    const first = [entry("m1", "bob", "Bob Smith", "Root"), ...replies];
    const at = Date.now();
    const list = (messages: CommentEntry[]) => (
      <CommentKitProvider value={kit()}>
        <CommentScrollArea items={messages.map((m) => ({ id: m.id, mine: false, at: m.id === "r3" ? at : 0 }))} ready label={(n) => `${n} new`}>
          <CommentThread thread={model(messages)} actions={actions()} canWrite />
        </CommentScrollArea>
      </CommentKitProvider>
    );
    const view = render(list(first));
    expect(screen.queryByText("Two")).toBeNull();
    view.rerender(list([...first, entry("r3", "bob", "Bob Smith", "Three", 180_000)]));
    expect(screen.getByText("Three")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 new" })).toBeInTheDocument();
  });

  function arriving(patch: Partial<CommentThreadModel> = {}) {
    const at = Date.now();
    const list = (messages: CommentEntry[]) => (
      <CommentKitProvider value={kit()}>
        <CommentScrollArea items={messages.map((m) => ({ id: m.id, mine: false, at: m.id.startsWith("late") ? at : 0 }))} ready label={(n) => `${n} new`}>
          <CommentThread thread={model(messages, patch)} actions={actions()} canWrite />
        </CommentScrollArea>
      </CommentKitProvider>
    );
    const first = [entry("m1", "bob", "Bob Smith", "Root"), entry("r1", "alice", "Alice Chen", "One", 60_000), entry("r2", "bob", "Bob Smith", "Two", 120_000)];
    return { view: render(list(first)), list, first };
  }

  it("opens a resolved thread when a late reply arrives in it", () => {
    const { view, list, first } = arriving({ resolution: "Resolved by Bob Smith" });
    expect(screen.queryByText("Two")).toBeNull();
    view.rerender(list([...first, entry("late1", "bob", "Bob Smith", "Actually, one more thing", 180_000)]));
    expect(screen.getByText("Actually, one more thing").closest("[data-comment-entry]")).toHaveAttribute("data-fresh");
  });

  it("keeps replies the reader folded closed when an earlier new reply stops being new", () => {
    vi.useFakeTimers();
    const rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 10 } as DOMRect);
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(private readonly report: IntersectionObserverCallback) {}
        observe(target: Element) {
          this.report([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
        }
        unobserve() {}
        disconnect() {}
      },
    );
    try {
      const { view, list, first } = arriving();
      const once = [...first, entry("late1", "bob", "Bob Smith", "Three", 180_000)];
      view.rerender(list(once));
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      view.rerender(list([...once, entry("late2", "alice", "Alice Chen", "Four", 240_000)]));
      fireEvent.click(screen.getByRole("button", { name: LABELS.hideReplies }));
      expect(screen.queryByText("Three")).toBeNull();
      act(() => {
        vi.advanceTimersByTime(3_100);
      });
      expect(screen.queryByText("Three")).toBeNull();
    } finally {
      rect.mockRestore();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("opens folded replies again for a second new reply after the reader folded them", async () => {
    const user = userEvent.setup();
    const { view, list, first } = arriving();
    const once = [...first, entry("late1", "bob", "Bob Smith", "Three", 180_000)];
    view.rerender(list(once));
    await user.click(screen.getByRole("button", { name: LABELS.hideReplies }));
    expect(screen.queryByText("Three")).toBeNull();
    view.rerender(list([...once, entry("late2", "alice", "Alice Chen", "Four", 240_000)]));
    expect(screen.getByText("Four")).toBeInTheDocument();
  });
});

describe("typing signal on reply", () => {
  it("doesn't announce a reply box that only holds its @mention prefill", () => {
    const onActivity = vi.fn();
    renderWith(
      <CommentComposer label={MESSAGE} submitLabel="Send" initial="@Bob Smith " onSubmit={vi.fn(async () => undefined)} onActivity={onActivity} />,
    );
    expect(onActivity).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: MESSAGE }), { target: { value: "@Bob Smith y" } });
    expect(onActivity).toHaveBeenCalledWith(true);
  });

  it("keeps refreshing while the person is still typing, so receivers never drop the line", () => {
    vi.useFakeTimers();
    try {
      const onActivity = vi.fn();
      renderWith(
        <CommentComposer label={MESSAGE} submitLabel="Send" onSubmit={vi.fn(async () => undefined)} onActivity={onActivity} />,
      );
      fireEvent.change(screen.getByRole("textbox", { name: MESSAGE }), { target: { value: "H" } });
      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      expect(onActivity.mock.calls.filter(([value]) => value === true).length).toBeGreaterThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("chat bubbles", () => {
  const withReactions = () => ({ ...kit(), reactions: { quick: ["👍", "🎉"] } });
  const CHAT = { remove: vi.fn(async () => undefined), react: vi.fn(async () => undefined) };

  function bubbles(entries: { entry: CommentEntry; continued?: boolean }[], value = withReactions(), canWrite = true) {
    return renderWith(
      <ol>
        {entries.map((item) => (
          <CommentItem
            key={item.entry.id}
            variant="bubble"
            continued={item.continued}
            entry={item.entry}
            canWrite={canWrite}
            actions={CHAT}
          />
        ))}
      </ol>,
      value,
    );
  }

  function row(text: string): HTMLElement {
    return screen.getByText(text).closest("[data-comment-entry]") as HTMLElement;
  }

  it("puts your message in a right bubble with only its time, and someone else's on the left under their name", () => {
    bubbles([
      { entry: entry("c1", "bob", "Bob Smith", "Draft is ready", 60_000) },
      { entry: entry("c2", SELF, "Alice Chen", "Reading it now", 2 * 60_000) },
    ]);
    const other = row("Draft is ready");
    const own = row("Reading it now");
    expect(other).not.toHaveAttribute("data-own");
    expect(other).toHaveTextContent("Bob Smith");
    expect(other.querySelector('[data-slot="avatar"]')).not.toBeNull();
    expect(other.querySelector("time")).not.toBeNull();
    expect(own).toHaveAttribute("data-own");
    expect(own).not.toHaveTextContent("Alice Chen");
    expect(own.querySelector('[data-slot="avatar"]')).toBeNull();
    expect(own.querySelector("time")).toHaveTextContent("8 min ago");
    const bubble = own.querySelector("[data-comment-bubble]") as HTMLElement;
    expect(bubble).toHaveClass("rounded-2xl", "border-sidebar-border", "bg-background");
    expect(bubble.parentElement).toHaveClass("max-w-[80%]");
    expect(bubble).toContainElement(screen.getByText("Reading it now"));
  });

  it("never counts an unverified author as you and keeps the unverified marker", () => {
    bubbles([{ entry: { ...entry("c1", SELF, "Unverified sender", "Trust me"), author: { id: SELF, name: "Unverified sender", verified: false } } }]);
    const unverified = row("Trust me");
    expect(unverified).not.toHaveAttribute("data-own");
    expect(screen.getByText("Unverified sender")).toHaveClass("italic");
  });

  it("drops the avatar and name on a follow-up and pulls it closer", () => {
    bubbles([
      { entry: entry("c1", "bob", "Bob Smith", "First", 60_000) },
      { entry: entry("c2", "bob", "Bob Smith", "Second", 2 * 60_000), continued: true },
    ]);
    const first = row("First");
    const second = row("Second");
    expect(first).toHaveClass("mt-3", "first:mt-0");
    expect(second).toHaveClass("mt-1");
    expect(second).not.toHaveTextContent("Bob Smith");
    expect(second.querySelector('[data-slot="avatar"]')).toBeNull();
  });

  it("keeps React and the menu beside the bubble, hidden until hover, with the pills under it", async () => {
    bubbles([{ entry: entry("c1", "bob", "Bob Smith", "Draft is ready", 0, [{ emoji: "👍", by: ["bob"] }]) }]);
    const other = row("Draft is ready");
    const side = other.querySelector("[data-comment-bubble-actions]") as HTMLElement;
    expect(side).toHaveClass("opacity-0", "group-hover/item:opacity-100", "has-[:focus-visible]:opacity-100");
    expect(side.className).not.toMatch(/focus-within/u);
    expect(within(side).getByRole("button", { name: "Add reaction" })).toBeInTheDocument();
    const pills = other.querySelector("[data-comment-actions]") as HTMLElement;
    expect(within(pills).getByRole("button", { name: "Bob Smith reacted with 👍" })).toBeInTheDocument();
    expect(within(pills).queryByRole("button", { name: "Add reaction" })).toBeNull();
    fireEvent.click(within(side).getByRole("button", { name: "Add reaction" }));
    fireEvent.click(await screen.findByRole("button", { name: "React with 🎉" }));
    expect(CHAT.react).toHaveBeenCalledWith("c1", "🎉", true);
    expect(within(pills).getByRole("button", { name: "you reacted with 🎉" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows waiting and not-sent messages on your side with what you can do about them", () => {
    const discard = vi.fn();
    const copyText = vi.fn(async () => undefined);
    bubbles(
      [
        { entry: { ...entry("q1", SELF, "Alice Chen", "Queued"), delivery: { state: "waiting" } } },
        { entry: { ...entry("q2", SELF, "Alice Chen", "Refused"), delivery: { state: "failed", reason: "Too long.", discard } } },
      ],
      { ...withReactions(), copyText },
    );
    const waiting = row("Queued");
    expect(waiting).toHaveAttribute("data-own");
    expect(waiting).toHaveTextContent("Waiting to send");
    expect(waiting.querySelector("time")).toBeNull();
    expect(screen.getByText("Queued").closest("[data-comment-body]")).toHaveClass("text-muted-foreground");
    const failed = row("Refused");
    expect(failed).toHaveTextContent("Not sent. Too long.");
    fireEvent.click(within(failed).getByRole("button", { name: "Copy text" }));
    expect(copyText).toHaveBeenCalledWith("Refused");
    fireEvent.click(within(failed).getByRole("button", { name: "Discard" }));
    expect(discard).toHaveBeenCalled();
    expect(within(failed).queryByRole("button", { name: "Add reaction" })).toBeNull();
  });

  it("draws a deleted message as a muted italic bubble, with the trash avatar only for someone else", () => {
    bubbles([
      { entry: { ...entry("d1", "bob", "Bob Smith", ""), deleted: true } },
      { entry: { ...entry("d2", SELF, "Alice Chen", ""), deleted: true } },
    ]);
    const [other, own] = screen.getAllByRole("listitem");
    expect(other.querySelector("[data-comment-bubble]")).toHaveClass("italic", "text-muted-foreground");
    expect(other).not.toHaveTextContent("Bob Smith");
    expect(other.querySelector(".lucide-trash2, .lucide-trash-2")).not.toBeNull();
    expect(own).toHaveAttribute("data-own");
    expect(own.querySelector('[data-slot="avatar"]')).toBeNull();
    expect(own.querySelector(".lucide-trash2, .lucide-trash-2")).toBeNull();
  });

  it("wraps a long word or link inside the bubble", () => {
    bubbles([{ entry: entry("c1", "bob", "Bob Smith", `https://example.org/${"a".repeat(120)}`) }]);
    expect(row("Bob Smith").querySelector("[data-comment-bubble]")).toHaveClass("[overflow-wrap:anywhere]");
  });

  it("groups a verified follow-up from the same person within five minutes of the group's first message", () => {
    const at = 1_000_000;
    const bob = { author: "bob", verified: true, at, deleted: false };
    const minutes = (value: number) => ({ ...bob, at: at + value * 60_000 });
    expect(chatGroups([bob, minutes(4), minutes(8), minutes(12)])).toEqual([false, true, false, true]);
    expect(chatGroups([bob, minutes(5)])).toEqual([false, false]);
    expect(chatGroups([bob, { ...bob, author: "carol" }])).toEqual([false, false]);
    expect(chatGroups([bob, { ...bob, verified: false }])).toEqual([false, false]);
    expect(chatGroups([{ ...bob, verified: false }, bob])).toEqual([false, false]);
    expect(chatGroups([{ ...bob, deleted: true }, bob])).toEqual([false, false]);
    expect(chatGroups([bob, { ...bob, deleted: true }])).toEqual([false, false]);
  });

  it("still gives a grouped follow-up its own time", () => {
    bubbles([
      { entry: entry("c1", "bob", "Bob Smith", "First", 60_000) },
      { entry: entry("c2", "bob", "Bob Smith", "Second", 4 * 60_000), continued: true },
    ]);
    const second = row("Second");
    expect(second.querySelector("time")).toHaveTextContent("6 min ago");
  });

  it("lays the New badge over the side column instead of widening it", () => {
    const at = Date.now();
    const list = (entries: CommentEntry[]) => (
      <CommentKitProvider value={withReactions()}>
        <CommentScrollArea items={entries.map((item) => ({ id: item.id, mine: false, at: item.id === "c2" ? at : 0 }))} ready label={(n) => `${n} new`}>
          <ol>
            {entries.map((item) => (
              <CommentItem key={item.id} variant="bubble" entry={item} canWrite actions={CHAT} />
            ))}
          </ol>
        </CommentScrollArea>
      </CommentKitProvider>
    );
    const first = [entry("c1", "bob", "Bob Smith", "Hi")];
    const view = render(list(first));
    view.rerender(list([...first, entry("c2", "bob", "Bob Smith", "New one")]));
    const badge = within(row("New one")).getByText("New");
    expect(badge).toHaveClass("absolute", "group-hover/item:opacity-0", "group-has-[:focus-visible]/item:opacity-0");
    expect(badge.className).not.toMatch(/focus-within/u);
    expect(badge.closest("[data-comment-bubble-side]")).toHaveClass("min-w-[3.125rem]");
  });

  it("keeps the bubble the same width while a message waits, is New, or has settled", () => {
    bubbles([
      { entry: { ...entry("q1", SELF, "Alice Chen", "Queued"), delivery: { state: "waiting" } } },
      { entry: entry("c1", "bob", "Bob Smith", "Settled") },
    ]);
    const queued = row("Queued");
    const settled = row("Settled");
    const side = (element: HTMLElement) => element.querySelector("[data-comment-bubble-side]") as HTMLElement;
    expect(side(queued)).toHaveClass("min-w-[3.125rem]", "shrink-0");
    expect(side(settled)).toHaveClass("min-w-[3.125rem]", "shrink-0");
    expect(side(queued)).not.toHaveTextContent("Waiting to send");
    expect(queued).toHaveTextContent("Waiting to send");
  });
});

describe("thread polish", () => {
  it("says a card waits to send on its own line under the body, not in the clipped header", () => {
    renderWith(
      <CommentThread
        thread={model([entry("m1", "bob", "Bob Smith", "Root"), { ...entry("q1", "alice", "Alexandra Johnson", "Keep the y-axis", 3 * 60_000), delivery: { state: "waiting" } }])}
        actions={actions()}
        canWrite
      />,
    );
    const row = screen.getByText("Keep the y-axis").closest("[data-comment-entry]") as HTMLElement;
    const waiting = within(row).getByText("Waiting to send");
    const byline = within(row).getByText("Alexandra Johnson").parentElement as HTMLElement;
    expect(byline).not.toContainElement(waiting);
    const body = within(row).getByText("Keep the y-axis").closest("[data-comment-body]") as HTMLElement;
    expect(body.compareDocumentPosition(waiting) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("lets the resolved line wrap so the resolver's name stays whole", () => {
    renderWith(<CommentThread thread={model([entry("m1", "bob", "Bob Smith", "Root")], { resolution: "Resolved by Bob Smith" })} actions={actions()} canWrite />);
    const line = screen.getByText("Resolved by Bob Smith").parentElement as HTMLElement;
    expect(line).not.toHaveClass("truncate");
  });

  it("draws times and '· edited' in a grey that clears 4.5:1 on the rail and on muted fills", () => {
    renderWith(<CommentThread thread={model([{ ...entry("m1", "bob", "Bob Smith", "Root", 60_000), editedAt: 120_000 }])} actions={actions()} canWrite />);
    for (const text of ["9 min ago", "· edited"]) {
      expect(screen.getByText(text)).toHaveClass("text-foreground/60");
      expect(screen.getByText(text)).not.toHaveClass("text-muted-foreground");
    }
  });

  it("underlines links in a comment so they stand apart from the text without colour", () => {
    renderWith(<CommentThread thread={model([entry("m1", "bob", "Bob Smith", "See https://example.org/a")])} actions={actions()} canWrite />);
    expect(screen.getByRole("link", { name: "https://example.org/a" })).toHaveClass("underline");
  });

  it("hides the chat New badge on touch screens, where the React button is always shown", () => {
    const list = (messages: CommentEntry[]) => (
      <CommentKitProvider value={kit()}>
        <CommentScrollArea items={messages.map((m) => ({ id: m.id, mine: false, at: m.id === "c2" ? Date.now() : 0 }))} ready label={(n) => `${n} new`}>
          <ol>
            {messages.map((m) => (
              <CommentItem key={m.id} entry={m} variant="bubble" canWrite actions={actions()} />
            ))}
          </ol>
        </CommentScrollArea>
      </CommentKitProvider>
    );
    const first = [entry("c1", "bob", "Bob Smith", "Hi")];
    const view = render(list(first));
    view.rerender(list([...first, entry("c2", "bob", "Bob Smith", "New one")]));
    expect(within(screen.getByText("New one").closest("[data-comment-entry]") as HTMLElement).getByText("New")).toHaveClass("pointer-coarse:opacity-0");
  });

  it("keeps a busy Resolve check where it is instead of hiding it under the pointer", async () => {
    const user = userEvent.setup();
    const slow = { ...actions(), resolve: vi.fn(() => new Promise<void>(() => undefined)) };
    renderWith(<CommentThread thread={model([entry("m1", "bob", "Bob Smith", "Root")])} actions={slow} canWrite />);
    const resolve = screen.getByRole("button", { name: LABELS.resolve });
    await user.click(resolve);
    expect(resolve).not.toBeDisabled();
    expect(resolve).toHaveAttribute("aria-disabled", "true");
    expect(resolve).toHaveClass("opacity-0", "group-hover/thread:opacity-100");
    await user.click(resolve);
    expect(slow.resolve).toHaveBeenCalledTimes(1);
  });

  it("lays a card out with the board's spacing", () => {
    renderWith(
      <CommentThread
        thread={model([entry("m1", "bob", "Bob Smith", "Root"), entry("m2", "alice", "Alice Chen", "Agreed", 60_000)])}
        actions={actions()}
        canWrite
      />,
    );
    const card = screen.getByRole("article");
    expect(card).toHaveClass("px-4", "py-3.5", "space-y-3");
    const replies = screen.getByText("Agreed").closest("ol") as HTMLElement;
    expect(replies).toHaveClass("space-y-4", "pl-4", "ml-3.5");
    expect(screen.getByText("Root").closest("[data-comment-entry]")).toHaveClass("gap-2.5");
  });

  it("makes the card's hover border visibly darker than its rest border in light and dark", () => {
    // Windows checks the file out with CRLF line ends.
    const globals = readFileSync(resolve(process.cwd(), "src/styles/globals.css"), "utf8").replaceAll("\r\n", "\n");
    const alpha = Number(/hover:border-foreground\/(\d+)/u.exec(commentCardClass(false))?.[1]) / 100;
    const block = (selector: string) => {
      const start = globals.indexOf(`${selector} {`);
      return globals.slice(start, globals.indexOf("}", start));
    };
    const token = (css: string, name: string): [number, number] => {
      const found = new RegExp(`--${name}:\\s*oklch\\(([\\d.]+) 0 0(?: / (\\d+)%)?\\)`, "u").exec(css);
      return [Number(found?.[1]), found?.[2] ? Number(found[2]) / 100 : 1];
    };
    const channel = (lightness: number) => {
      const linear = lightness ** 3;
      return linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
    };
    const lightnessOf = (value: number) => Math.cbrt(value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    for (const css of [block(":root,\n.light"), block(".dark")]) {
      const [background] = token(css, "background");
      const [foreground] = token(css, "foreground");
      const [border, borderAlpha] = token(css, "sidebar-border");
      const over = (lightness: number, amount: number) => channel(lightness) * amount + channel(background) * (1 - amount);
      const rest = lightnessOf(over(border, borderAlpha));
      const hover = lightnessOf(over(foreground, alpha));
      expect(Math.abs(hover - rest)).toBeGreaterThanOrEqual(0.04);
    }
  });
});

describe("headers after the third review", () => {
  const RING = /(?:^|\s)(?:[\w-]+:)*(?:ring|outline|shadow)(?:-|\s|$)/u;

  function overlayOf(button: HTMLElement): HTMLElement {
    let node: HTMLElement | null = button;
    while (node && !node.className.toString().split(" ").includes("absolute")) node = node.parentElement;
    return node as HTMLElement;
  }

  it("shows the ⋯ and Resolve in one tinted pill, with one rule for hover, keyboard focus, an open menu and touch", () => {
    renderWith(<CommentThread thread={model([entry("m1", "bob", "Daniel Hartmann", "Root")])} actions={actions()} canWrite embedded />);
    const menu = screen.getByRole("button", { name: LABELS.messageActions });
    const resolve = screen.getByRole("button", { name: LABELS.resolve });
    const overlay = overlayOf(menu);
    expect(overlay).toBe(overlayOf(resolve));
    expect(overlay).toHaveClass("absolute", "end-0", "has-[button]:bg-accent", "opacity-0", "transition-opacity");
    for (const state of ["group-hover/item", "has-[:focus-visible]", "has-[[data-state=open]]", "[@media(hover:none)]"]) {
      expect(overlay).toHaveClass(`${state}:opacity-100`);
    }
    expect(overlay.className).not.toMatch(/(?:^|\s)focus-within:/u);
    expect(overlay.parentElement).toHaveClass("[@media(hover:none)]:min-h-6");
    for (const button of [menu, resolve]) {
      expect(button.className).not.toMatch(/(?:^|\s)[\w/[\]():@-]+:(?:w|ms|me|size)-/u);
      expect(button.className).not.toMatch(/(?:^|\s)(?:w-0|pointer-coarse:)/u);
      expect(button).toHaveClass("size-6");
      expect(button.className).not.toMatch(RING);
    }
    expect(overlay.className).not.toMatch(RING);
    expect(overlay.className).not.toMatch(/yellow|amber/u);
  });

  it("shows the header ⋯ and Resolve through the overlay only, not through their own opacity", () => {
    renderWith(<CommentThread thread={model([entry("m1", SELF, "Prajwal S Venkatesh", "Mine")])} actions={actions()} canWrite embedded />);
    for (const name of [LABELS.messageActions, LABELS.resolve]) {
      const button = screen.getByRole("button", { name });
      expect(button.className).not.toMatch(/(?:^|\s)(?:\S+:)?opacity-(?:0|100)(?:\s|$)/u);
    }
  });

  it("keeps the name on a fixed-height first line and lets the time and '· edited' wrap whole under it, never cut", () => {
    renderWith(<CommentThread thread={model([{ ...entry("m1", SELF, "Prajwal S Venkatesh", "Mine", 3 * 60_000), editedAt: 4 * 60_000 }])} actions={actions()} canWrite />);
    const name = screen.getByText("Prajwal S Venkatesh");
    const time = screen.getByText("7 min ago");
    const edited = screen.getByText("· edited");
    const byline = name.parentElement as HTMLElement;
    expect(name).toHaveClass("leading-6", "truncate", "max-w-full", "shrink-0");
    expect(byline).toHaveClass("flex", "flex-wrap", "items-baseline", "gap-x-1.5", "min-w-0");
    expect(byline).not.toHaveClass("overflow-hidden");
    expect(time.parentElement?.parentElement).toBe(byline);
    expect(edited.parentElement?.parentElement?.parentElement).toBe(byline);
    for (const text of [time, edited]) expect(text).toHaveClass("leading-4", "text-[0.6875rem]");
    expect(time).not.toHaveClass("truncate");
    for (let node: HTMLElement | null = time; node && node !== byline; node = node.parentElement) {
      expect(node.className).not.toMatch(/(?:^|\s)(?:h-4|overflow-hidden|truncate|basis-\[3em\]|before:)/u);
    }
    expect(byline.parentElement?.className).not.toMatch(/(?:^|\s)items-center(?:\s|$)/u);
  });

  it("puts the New badge in the header's flow after the time, so it wraps instead of cutting the name", () => {
    const list = (messages: CommentEntry[]) => (
      <CommentKitProvider value={kit()}>
        <CommentScrollArea items={messages.map((m) => ({ id: m.id, mine: false, at: m.id === "r1" ? Date.now() : 0 }))} ready label={(n) => `${n} new`}>
          <CommentThread thread={model(messages)} actions={actions()} canWrite />
        </CommentScrollArea>
      </CommentKitProvider>
    );
    const first = [entry("m1", "bob", "Bob Smith", "Root")];
    const view = render(list(first));
    view.rerender(list([...first, entry("r1", "bob", "Alexandra Johnson", "Sounds good", 5 * 60_000)]));
    const row = screen.getByText("Sounds good").closest("[data-comment-entry]") as HTMLElement;
    const byline = within(row).getByText("Alexandra Johnson").parentElement as HTMLElement;
    const badge = within(row).getByText("New");
    expect(badge.parentElement).toBe(byline);
    expect(within(row).getByText("5 min ago").compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("leaves no overlay at all on a row with nothing to act on, so touch screens reserve no blank line for it", () => {
    const replies = [entry("r1", "bob", "Bob Smith", "Agreed"), { ...entry("q1", SELF, "Alice Chen", "Queued"), delivery: { state: "waiting" as const } }];
    for (const reply of replies) {
      const view = renderWith(<CommentThread thread={model([entry("m1", "bob", "Bob Smith", "Root"), reply])} actions={actions()} canWrite />);
      const row = screen.getByText(reply.body).closest("[data-comment-entry]") as HTMLElement;
      expect(row.querySelector(".absolute")).toBeNull();
      expect(row.querySelector(".min-w-6")).toBeNull();
      view.unmount();
    }
  });

  it("returns focus to the ⋯ after Escape closes a menu opened from the keyboard", async () => {
    const user = userEvent.setup();
    renderWith(<CommentThread thread={model([entry("m1", SELF, "Alice Chen", "Mine")])} actions={actions()} canWrite />);
    const menu = screen.getByRole("button", { name: LABELS.messageActions });
    menu.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("menuitem", { name: LABELS.edit })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menuitem", { name: LABELS.edit })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(menu));
  });

  it("still hands focus to the editor when Edit is picked from the ⋯ menu", async () => {
    const user = userEvent.setup();
    renderWith(<CommentThread thread={model([entry("m1", SELF, "Alice Chen", "Mine")])} actions={actions()} canWrite />);
    screen.getByRole("button", { name: LABELS.messageActions }).focus();
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("menuitem", { name: LABELS.edit }));
    const field = screen.getByRole("textbox", { name: LABELS.editLabel });
    await waitFor(() => expect(document.activeElement).toBe(field));
  });

  it("lets a long Reopen label wrap under the resolved summary instead of squeezing it into a narrow column", () => {
    renderWith(<CommentThread thread={model([entry("m1", "bob", "Bob Smith", "Root")], { resolution: "Rozwiązane przez: prajwal.venkateshmurthy" })} actions={actions()} canWrite />, kit({ reopen: "Otwórz ponownie" }));
    const reopen = screen.getByRole("button", { name: "Otwórz ponownie" });
    const summary = screen.getByRole("button", { name: /Rozwiązane przez/u });
    expect(reopen.parentElement).toBe(summary.parentElement);
    expect(reopen.parentElement).toHaveClass("flex", "flex-wrap");
    expect(summary).toHaveClass("grow", "basis-34", "min-w-0");
    expect(summary).not.toHaveClass("flex-1");
    expect(reopen).toHaveClass("ms-auto", "shrink-0");
  });

  it("points the replies toggle at the list it opens, so opening above the toggle counts as the reader's own", async () => {
    const user = userEvent.setup();
    const thread = model([
      entry("m1", "bob", "Bob Smith", "Root"),
      entry("m2", "alice", "Alice Chen", "First reply", 2 * 60_000),
      entry("m3", "bob", "Bob Smith", "Second reply", 6 * 60_000),
    ]);
    renderWith(<CommentThread thread={thread} actions={actions()} canWrite />);
    const toggle = screen.getByRole("button", { name: /2 replies/u });
    const id = toggle.getAttribute("aria-controls") as string;
    expect(id).toBeTruthy();
    await user.click(toggle);
    expect(document.getElementById(id)).toBe(screen.getByRole("list", { name: "2 replies" }));
  });

  it("points Show more at the quote text it opens", () => {
    const scroll = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.dataset.quoteText === undefined ? 0 : 200;
    });
    const client = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.dataset.quoteText === undefined ? 0 : 40;
    });
    try {
      renderWith(<CommentQuote quote={"A long quote ".repeat(20)} labels={LABELS} />);
      const text = document.querySelector("[data-quote-text]") as HTMLElement;
      expect(text.id).toBeTruthy();
      expect(screen.getByRole("button", { name: LABELS.showMore })).toHaveAttribute("aria-controls", text.id);
    } finally {
      scroll.mockRestore();
      client.mockRestore();
    }
  });

  it("wraps an unbreakable resolver name inside its own column", () => {
    renderWith(<CommentThread thread={model([entry("m1", "bob", "Bob Smith", "Root")], { resolution: "Resolved by prajwal.venkateshmurthy" })} actions={actions()} canWrite />);
    expect(screen.getByText("Resolved by prajwal.venkateshmurthy").parentElement).toHaveClass("[overflow-wrap:anywhere]");
  });
});

describe("headers after the fourth review", () => {
  function reserveOf(button: HTMLElement): HTMLElement {
    let node: HTMLElement | null = button;
    while (node && !node.className.toString().split(" ").includes("absolute")) node = node.parentElement;
    return node?.parentElement as HTMLElement;
  }

  function freshKit(): CommentKit {
    return { ...kit({ removeConfirm: { title: "Remove this comment?", description: "Replies stay." } }), moderate: true };
  }

  it("reserves the two-button pill's real width beside the time on every device, so hover never covers it", () => {
    renderWith(<CommentThread thread={model([entry("m1", "bob", "Tom Becker", "Root", 60_000)])} actions={actions()} canWrite embedded />);
    const reserve = reserveOf(screen.getByRole("button", { name: LABELS.messageActions }));
    expect(reserve).toBe(reserveOf(screen.getByRole("button", { name: LABELS.resolve })));
    expect(reserve).toHaveClass("relative", "min-w-12", "grow", "self-stretch");
    expect(reserve.className).not.toMatch(/(?:^|\s)(?:basis-0|-ms-1\.5|\[@media\(hover:none\)\]:basis-\d+)(?:\s|$)/u);
    const tail = reserve.parentElement as HTMLElement;
    expect(tail).toContainElement(screen.getByText("9 min ago"));
    expect(tail).not.toContainElement(screen.getByText("Tom Becker"));
    expect(tail).toHaveClass("flex", "grow", "min-w-0");
    expect(tail).not.toHaveClass("flex-wrap");
  });

  it("reserves one button's width beside '· edited' on a row with only the ⋯", () => {
    renderWith(<CommentThread thread={model([{ ...entry("m1", SELF, "Prajwal S Venkatesh", "Mine", 3 * 60_000), editedAt: 4 * 60_000 }])} actions={actions()} canWrite />);
    const reserve = reserveOf(screen.getByRole("button", { name: LABELS.messageActions }));
    expect(reserve).toHaveClass("min-w-6");
    expect(reserve).not.toHaveClass("min-w-12");
    expect(reserve.parentElement).toContainElement(screen.getByText("· edited"));
  });

  it("keeps the New badge clear of the ⋯ by reserving the pill beside the badge", () => {
    const list = (messages: CommentEntry[]) => (
      <CommentKitProvider value={freshKit()}>
        <CommentScrollArea items={messages.map((m) => ({ id: m.id, mine: false, at: m.id === "r1" ? Date.now() : 0 }))} ready label={(n) => `${n} new`}>
          <CommentThread thread={model(messages)} actions={{ ...actions(), moderate: vi.fn(async () => undefined) }} canWrite />
        </CommentScrollArea>
      </CommentKitProvider>
    );
    const first = [entry("m1", "bob", "Bob Smith", "Root")];
    const view = render(list(first));
    view.rerender(list([...first, entry("r1", "bob", "Bo", "Sounds good", 2 * 60_000)]));
    const row = screen.getByText("Sounds good").closest("[data-comment-entry]") as HTMLElement;
    const reserve = reserveOf(within(row).getByRole("button", { name: LABELS.messageActions }));
    expect(within(row).getByText("New").parentElement).toBe(reserve.parentElement);
    expect(reserve.parentElement).not.toContainElement(within(row).getByText("8 min ago"));
    expect(reserve.parentElement?.className.split(" ").filter((name) => /(?:^|:)m[tby]-/u.test(name))).toEqual([]);
  });

  it("reserves a deleted root's Resolve beside its text, so the check never covers it", () => {
    renderWith(<CommentThread thread={model([{ ...entry("m1", "bob", "Bob Smith", ""), deleted: true, removed: true }])} actions={actions()} canWrite embedded />);
    const reserve = reserveOf(screen.getByRole("button", { name: LABELS.resolve }));
    expect(reserve).toHaveClass("min-w-6", "grow");
    const text = screen.getByText(LABELS.removed);
    expect(text.parentElement).toBe(reserve.parentElement);
    expect(text).toHaveClass("min-w-0");
    expect(text.className).not.toMatch(/(?:^|\s)leading-/u);
    expect(reserve.querySelector(".absolute")).toHaveClass("opacity-0", "group-hover/item:opacity-100");
  });

  it("returns focus to the ⋯ after Copy link is picked from a menu opened with the keyboard", async () => {
    const user = userEvent.setup();
    const copyText = vi.fn(async () => undefined);
    renderWith(<CommentThread thread={model([entry("m1", "bob", "Bob Smith", "Root")], { link: "oleafly://open?thread=t1" })} actions={actions()} canWrite />, { ...kit(), copyText });
    const menu = screen.getByRole("button", { name: LABELS.messageActions });
    menu.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("menuitem", { name: LABELS.copyLink })).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(copyText).toHaveBeenCalledWith("oleafly://open?thread=t1"));
    await waitFor(() => expect(document.activeElement).toBe(menu));
  });

  it("returns focus to the ⋯ when the Delete confirm opened from the keyboard is cancelled", async () => {
    const user = userEvent.setup();
    const remove = vi.fn(async () => undefined);
    renderWith(<CommentThread thread={model([entry("m1", SELF, "Alice Chen", "Mine")])} actions={{ ...actions(), remove }} canWrite />, {
      ...kit(),
      Confirm: (props) => <ConfirmationDialog {...props} destructive />,
    });
    const menu = screen.getByRole("button", { name: LABELS.messageActions });
    menu.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("menuitem", { name: LABELS.edit })).toHaveFocus();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: LABELS.delete })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("alertdialog", { name: LABELS.deleteMessageConfirm.title })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(menu));
    expect(remove).not.toHaveBeenCalled();
  });
});

describe("headers after the fifth review", () => {
  const RESOLVED = "Resolved by Alice Chen";
  const ELSEWHERE = "Elsewhere";

  function threadKit(): CommentKit {
    return {
      ...kit({ deleteThread: "Delete thread", deleteThreadConfirm: { title: "Delete this thread?", description: "Replies go too." } }),
      moderate: true,
      Confirm: (props) => <ConfirmationDialog {...props} destructive />,
    };
  }

  function resolvable(given: CommentThreadActions, embedded: boolean, resolution: string | null = null) {
    return (
      <CommentKitProvider value={kit()}>
        <CommentThread thread={model([entry("m1", "bob", "Bob Smith", "Root")], { resolution })} actions={given} canWrite embedded={embedded} />
      </CommentKitProvider>
    );
  }

  async function openMenu(user: ReturnType<typeof userEvent.setup>, menu: HTMLElement, item: string) {
    menu.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("menuitem", { name: item });
    for (let step = 0; step < 6 && document.activeElement?.textContent !== item; step += 1) await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toHaveTextContent(item);
    await user.keyboard("{Enter}");
  }

  it.each([
    ["the quote chip's check", false],
    ["the header check of a thread without a quote", true],
  ])("moves focus to the resolved summary when Enter on %s resolves the thread and it folds", async (_, embedded) => {
    const user = userEvent.setup();
    const given = actions();
    const view = render(resolvable(given, embedded));
    screen.getByRole("button", { name: LABELS.resolve }).focus();
    await user.keyboard("{Enter}");
    expect(given.resolve).toHaveBeenCalledTimes(1);
    view.rerender(resolvable(given, embedded, RESOLVED));
    expect(screen.queryByText("Root")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: new RegExp(RESOLVED, "u") }));
  });

  it("returns focus to the ⋯ after Resolve is picked from a menu opened with the keyboard, then to the summary once the thread folds", async () => {
    const user = userEvent.setup();
    const given = actions();
    const view = render(resolvable(given, false));
    const menu = screen.getByRole("button", { name: LABELS.messageActions });
    await openMenu(user, menu, LABELS.resolve);
    await waitFor(() => expect(document.activeElement).toBe(menu));
    expect(given.resolve).toHaveBeenCalledTimes(1);
    view.rerender(resolvable(given, false, RESOLVED));
    expect(menu.isConnected).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: new RegExp(RESOLVED, "u") }));
  });

  it("moves focus to the summary on a selected thread too, where Resolve unmounts but the thread stays open", async () => {
    const user = userEvent.setup();
    const given = actions();
    const selected = (resolution: string | null) => (
      <CommentKitProvider value={kit()}>
        <CommentThread thread={model([entry("m1", "bob", "Bob Smith", "Root")], { resolution })} actions={given} canWrite selected />
      </CommentKitProvider>
    );
    const view = render(selected(null));
    screen.getByRole("button", { name: LABELS.resolve }).focus();
    await user.keyboard("{Enter}");
    view.rerender(selected(RESOLVED));
    expect(screen.getByText("Root")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: new RegExp(RESOLVED, "u") }));
  });

  it("leaves focus alone when the reader moved on, after a click that left focus on the page, when someone else resolves, and after a Resolve that failed", async () => {
    const user = userEvent.setup();
    const given = actions();
    const outside = (node: ReactNode) => (
      <>
        <button type="button">{ELSEWHERE}</button>
        {node}
      </>
    );
    const view = render(outside(resolvable(given, false)));
    screen.getByRole("button", { name: LABELS.resolve }).focus();
    await user.keyboard("{Enter}");
    screen.getByRole("button", { name: ELSEWHERE }).focus();
    view.rerender(outside(resolvable(given, false, RESOLVED)));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: ELSEWHERE }));
    view.unmount();

    const clicked = actions();
    const click = render(resolvable(clicked, false));
    fireEvent.click(screen.getByRole("button", { name: LABELS.resolve }));
    expect(clicked.resolve).toHaveBeenCalledTimes(1);
    click.rerender(resolvable(clicked, false, RESOLVED));
    expect(document.activeElement).toBe(document.body);
    click.unmount();

    const remote = render(resolvable(actions(), false));
    remote.rerender(resolvable(actions(), false, RESOLVED));
    expect(document.activeElement).toBe(document.body);
    remote.unmount();

    const failing = { ...actions(), resolve: vi.fn(async () => Promise.reject(new Error("offline"))) };
    const failed = render(resolvable(failing, false));
    screen.getByRole("button", { name: LABELS.resolve }).focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByText("It failed.")).toBeInTheDocument();
    (document.activeElement as HTMLElement).blur();
    failed.rerender(resolvable(failing, false, RESOLVED));
    expect(document.activeElement).toBe(document.body);
  });

  it.each([
    ["Delete", "m1", SELF, "deleteMessageConfirm"],
    ["Remove…", "m1", "bob", "removeConfirm"],
    ["Delete thread", "m1", SELF, "deleteThreadConfirm"],
  ] as const)("returns focus to the ⋯ when the %s confirm opened from the keyboard is cancelled with its Cancel button, and runs it on confirm", async (item, id, author, confirm) => {
    const user = userEvent.setup();
    const given = { ...actions(), remove: vi.fn(async () => undefined), moderate: vi.fn(async () => undefined), removeThread: vi.fn(async () => undefined) };
    const value = threadKit();
    renderWith(<CommentThread thread={model([entry(id, author, "Bob Smith", "Root")], { deletable: true })} actions={given} canWrite />, value);
    const menu = screen.getByRole("button", { name: LABELS.messageActions });
    const title = (value.labels[confirm] as { title: string }).title;
    await openMenu(user, menu, item);
    const dialog = await screen.findByRole("alertdialog", { name: title });
    await user.click(within(dialog).getByRole("button", { name: /Cancel/u }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(menu));
    for (const action of [given.remove, given.moderate, given.removeThread]) expect(action).not.toHaveBeenCalled();
    await openMenu(user, menu, item);
    await user.click(within(await screen.findByRole("alertdialog", { name: title })).getByRole("button", { name: item }));
    const ran = { Delete: given.remove, "Remove…": given.moderate, "Delete thread": given.removeThread }[item];
    await waitFor(() => expect(ran).toHaveBeenCalledTimes(1));
    if (item !== "Delete thread") expect(ran).toHaveBeenCalledWith(id);
  });
});

describe("headers after the final check", () => {
  type Box = [left: number, top: number, right: number, bottom: number];
  const MARGINS = /(?:^|:)(?:m[tby]|gap-y)-/u;

  function rect([left, top, right, bottom]: Box): DOMRect {
    return { left, top, right, bottom, x: left, y: top, width: right - left, height: bottom - top, toJSON: () => ({}) } as DOMRect;
  }

  type Place = Box | (() => Box);
  const at = (place: Place | undefined): Box => (typeof place === "function" ? place() : (place ?? [0, 0, 0, 0]));

  function lay(boxes: Map<Element, Place>, lines: Map<Node, Place[]>, tail?: HTMLElement) {
    const box = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      return rect(at(boxes.get(this)));
    });
    const real = window.getComputedStyle.bind(window);
    const style = vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
      if (element !== tail) return real(element, pseudo);
      return { marginTop: tail.classList.contains("mt-1") ? "4px" : "0px", marginBottom: tail.classList.contains("mb-0.5") ? "2px" : "0px" } as CSSStyleDeclaration;
    });
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value(this: Range) {
        return (lines.get(this.startContainer) ?? []).map((line) => rect(at(line)));
      },
    });
    return () => {
      box.mockRestore();
      style.mockRestore();
      Reflect.deleteProperty(Range.prototype, "getClientRects");
    };
  }

  const shifted = (element: HTMLElement, name: string, by: number, [left, top, right, bottom]: Box) => (): Box =>
    element.classList.contains(name) ? [left, top + by, right, bottom + by] : [left, top, right, bottom];

  function parts(menu: HTMLElement) {
    const pill = menu.closest(".absolute") as HTMLElement;
    const tail = pill.parentElement?.parentElement as HTMLElement;
    const row = tail.parentElement as HTMLElement;
    return { pill, tail, row, before: tail.previousElementSibling as HTMLElement, next: row.nextElementSibling as HTMLElement | null };
  }

  const margins = (element: HTMLElement) => element.className.split(" ").filter((name) => MARGINS.test(name));
  const textOf = (element: Element) => document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode() as Node;

  function editedReply() {
    const given = actions();
    const thread = model([entry("m1", "bob", "Bob Smith", "Root", 60_000), { ...entry("m2", SELF, "Prajwal S Venkatesh", "Mine", 3 * 60_000), editedAt: 4 * 60_000 }]);
    const tree = () => (
      <CommentKitProvider value={kit()}>
        <CommentThread thread={thread} actions={given} canWrite />
      </CommentKitProvider>
    );
    const view = render(tree());
    const menu = screen.getAllByRole("button", { name: LABELS.messageActions })[1];
    return { ...parts(menu), relayout: () => view.rerender(tree()), view };
  }

  it("adds no room at all until the pill would actually reach text", () => {
    const { tail, row } = editedReply();
    expect(margins(tail)).toEqual([]);
    expect(margins(row)).toEqual([]);
    expect(tail).toContainElement(screen.getByText("· edited"));
  });

  it("gives the pill 4px above only when its line sits under the time and the time runs under it, never when they share a line", () => {
    const { tail, pill, before, relayout } = editedReply();
    const time = textOf(before);
    const restore = lay(
      new Map<Element, Place>([[before, [0, 24, 130, 40]], [tail, shifted(tail, "mt-1", 4, [0, 40, 138, 56])], [pill, shifted(tail, "mt-1", 4, [114, 36, 138, 60])]]),
      new Map([[time, [[0, 25.3, 130, 38.6]]]]),
      tail,
    );
    try {
      relayout();
      expect(margins(tail)).toEqual(["mt-1"]);
      relayout();
      expect(margins(tail)).toEqual(["mt-1"]);
    } finally {
      restore();
    }
    const shared = lay(
      new Map<Element, Place>([[before, [0, 24, 120, 40]], [tail, [84, 24, 138, 40]], [pill, [114, 20, 138, 44]]]),
      new Map([[time, [[0, 25.3, 120, 38.6]]]]),
    );
    try {
      relayout();
      expect(margins(tail)).toEqual([]);
    } finally {
      shared();
    }
    const short = lay(
      new Map<Element, Place>([[before, [0, 24, 90, 40]], [tail, [0, 40, 138, 56]], [pill, [114, 36, 138, 60]]]),
      new Map([[time, [[0, 25.3, 90, 38.6]]]]),
    );
    try {
      relayout();
      expect(margins(tail)).toEqual([]);
    } finally {
      short();
    }
  });

  it("gives the pill 2px below only when the comment's first line runs under it, whether or not the pill shares its line with the time", () => {
    const { tail, pill, before, next, relayout } = editedReply();
    const body = textOf(next as HTMLElement);
    const restore = lay(
      new Map<Element, Place>([[before, [0, 0, 60, 24]], [tail, [0, 24, 138, 40]], [pill, [114, 20, 138, 44]]]),
      new Map([[body, [shifted(tail, "mb-0.5", 2, [0, 43, 138, 58])]]]),
      tail,
    );
    try {
      relayout();
      expect(margins(tail)).toEqual(["mb-0.5"]);
      relayout();
      expect(margins(tail)).toEqual(["mb-0.5"]);
    } finally {
      restore();
    }
    const beside = lay(
      new Map<Element, Place>([[before, [0, 24, 80, 40]], [tail, [84, 24, 138, 40]], [pill, [114, 20, 138, 44]]]),
      new Map([[body, [[0, 43, 138, 58]]]]),
    );
    try {
      relayout();
      expect(margins(tail)).toEqual(["mb-0.5"]);
    } finally {
      beside();
    }
    const clear = lay(
      new Map<Element, Place>([[before, [0, 0, 60, 24]], [tail, [0, 24, 138, 40]], [pill, [114, 20, 138, 44]]]),
      new Map([[body, [[0, 44.3, 138, 59]]]]),
    );
    try {
      relayout();
      expect(margins(tail)).toEqual([]);
    } finally {
      clear();
    }
  });

  function watched() {
    const observers: { callback: (entries: { target: Element }[]) => void; targets: Set<Element> }[] = [];
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      private readonly targets = new Set<Element>();
      constructor(callback: (entries: { target: Element }[]) => void) {
        observers.push({ callback, targets: this.targets });
      }
      observe(target: Element) {
        this.targets.add(target);
      }
      unobserve(target: Element) {
        this.targets.delete(target);
      }
      disconnect() {
        this.targets.clear();
      }
    } as unknown as typeof ResizeObserver;
    return {
      observers,
      resize: () =>
        act(() => {
          for (const { callback, targets } of observers) callback([...targets].map((target) => ({ target })));
        }),
      restore: () => {
        globalThis.ResizeObserver = original;
      },
    };
  }

  it("re-measures when the row is resized, not only when it renders", () => {
    const sizes = watched();
    try {
      const { tail, pill, before } = editedReply();
      const restore = lay(
        new Map<Element, Place>([[before, [0, 24, 130, 40]], [tail, [0, 40, 138, 56]], [pill, [114, 36, 138, 60]]]),
        new Map([[textOf(before), [[0, 25.3, 130, 38.6]]]]),
      );
      try {
        expect(margins(tail)).toEqual([]);
        expect(sizes.observers.length).toBeGreaterThan(0);
        sizes.resize();
        expect(margins(tail)).toEqual(["mt-1"]);
      } finally {
        restore();
      }
    } finally {
      sizes.restore();
    }
  });

  it("measures each header once, not on every redraw, and watches every row with one observer", () => {
    const sizes = watched();
    try {
      const given = actions();
      const value = kit();
      const thread = model([entry("m1", "bob", "Bob Smith", "Root", 60_000), entry("r1", SELF, "Prajwal S Venkatesh", "Reply", 2 * 60_000)]);
      const tree = (key: number) => (
        <CommentKitProvider value={value}>
          <CommentThread key="t" thread={{ ...thread, label: `Thread ${key}` }} actions={given} canWrite />
        </CommentKitProvider>
      );
      const view = render(tree(0));
      expect(sizes.observers).toHaveLength(1);
      expect(sizes.observers[0].targets.size).toBeGreaterThan(1);
      const style = vi.spyOn(window, "getComputedStyle");
      try {
        for (let round = 1; round <= 5; round += 1) view.rerender(tree(round));
        expect(style).not.toHaveBeenCalled();
      } finally {
        style.mockRestore();
      }
      view.unmount();
      expect(sizes.observers[0].targets.size).toBe(0);
    } finally {
      sizes.restore();
    }
  });

  it("opens 4px under a deleted message's text only when the unverified name wraps under it and the text runs under the check", () => {
    const given = actions();
    const thread = model([{ ...entry("m1", "bob", "Bob Smith", ""), deleted: true, author: { id: "bob", name: "Bob Smith", verified: false } }]);
    const tree = () => (
      <CommentKitProvider value={kit()}>
        <CommentThread thread={thread} actions={given} canWrite embedded />
      </CommentKitProvider>
    );
    const view = render(tree());
    const { tail, pill, before, row } = parts(screen.getByRole("button", { name: LABELS.resolve }));
    expect(before).toHaveTextContent(LABELS.deleted);
    expect(margins(row)).toEqual([]);
    const restore = lay(
      new Map<Element, Place>([[before, [0, 2.7, 130, 21.3]], [tail, [0, 21.3, 130, 37]], [pill, [106, 17.15, 130, 41.15]]]),
      new Map([[textOf(before), [[0, 4.4, 128, 19.6]]]]),
    );
    try {
      view.rerender(tree());
      expect(margins(tail)).toEqual(["mt-1"]);
      expect(margins(row)).toEqual([]);
    } finally {
      restore();
    }
  });

  it("hands focus back to nobody after a mouse pick from ⋯, so the pill and the quote's check don't stay shown", async () => {
    const user = userEvent.setup();
    const copyText = vi.fn(async () => undefined);
    const value: CommentKit = {
      ...kit({ deleteThread: "Delete thread", deleteThreadConfirm: { title: "Delete this thread?", description: "Replies go too." } }),
      copyText,
      Confirm: (props) => <ConfirmationDialog {...props} destructive />,
    };
    const view = renderWith(<CommentThread thread={model([entry("m1", SELF, "Alice Chen", "Mine")], { link: "oleafly://t1", deletable: true })} actions={actions()} canWrite />, value);
    const menu = screen.getByRole("button", { name: LABELS.messageActions });
    await user.click(menu);
    await user.click(await screen.findByRole("menuitem", { name: LABELS.copyLink }));
    await waitFor(() => expect(copyText).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(document.activeElement).toBe(document.body);
    await user.click(menu);
    await user.click(await screen.findByRole("menuitem", { name: "Delete thread" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Delete this thread?" });
    await user.click(within(dialog).getByRole("button", { name: /Cancel/u }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(document.activeElement).not.toBe(menu);
    view.unmount();
  });

  it("leaves focus with nobody after a mouse pick of Resolve, even once the thread folds", async () => {
    const user = userEvent.setup();
    const given = actions();
    const tree = (resolution: string | null) => (
      <CommentKitProvider value={kit()}>
        <CommentThread thread={model([entry("m1", "bob", "Bob Smith", "Root")], { resolution })} actions={given} canWrite />
      </CommentKitProvider>
    );
    const picked = render(tree(null));
    await user.click(screen.getByRole("button", { name: LABELS.messageActions }));
    await user.click(await screen.findByRole("menuitem", { name: LABELS.resolve }));
    await waitFor(() => expect(given.resolve).toHaveBeenCalledTimes(1));
    picked.rerender(tree("Resolved by Alice Chen"));
    expect(document.activeElement).toBe(document.body);
  });

  it("hands focus back to nobody after a mouse pick from a chat bubble's ⋯", async () => {
    const user = userEvent.setup();
    renderWith(
      <ol>
        <CommentItem variant="bubble" entry={entry("c1", SELF, "Alice Chen", "Mine")} canWrite actions={{ remove: vi.fn(async () => undefined) }} />
      </ol>,
      { ...kit(), Confirm: (props) => <ConfirmationDialog {...props} destructive /> },
    );
    const bubbleMenu = screen.getByRole("button", { name: LABELS.messageActions });
    await user.click(bubbleMenu);
    await user.click(await screen.findByRole("menuitem", { name: LABELS.delete }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: /Cancel/u }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(document.activeElement).not.toBe(bubbleMenu);
  });

  it("still returns focus to ⋯ when the pick is made with the keyboard after the menu was opened with the mouse", async () => {
    const user = userEvent.setup();
    const copyText = vi.fn(async () => undefined);
    renderWith(<CommentThread thread={model([entry("m1", "bob", "Bob Smith", "Root")], { link: "oleafly://t1" })} actions={actions()} canWrite />, { ...kit(), copyText });
    const menu = screen.getByRole("button", { name: LABELS.messageActions });
    await user.click(menu);
    await screen.findByRole("menuitem", { name: LABELS.copyLink });
    for (let step = 0; step < 4 && document.activeElement?.textContent !== LABELS.copyLink; step += 1) await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toHaveTextContent(String(LABELS.copyLink));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(copyText).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.activeElement).toBe(menu));
  });

  it("doesn't pull focus to the summary when a check press was dropped while another thread action ran", async () => {
    const user = userEvent.setup();
    let release = () => {};
    const copyText = vi.fn(() => new Promise<void>((done) => { release = done; }));
    const given = actions();
    const tree = (resolution: string | null) => (
      <CommentKitProvider value={{ ...kit(), copyText }}>
        <CommentThread thread={model([entry("m1", "bob", "Bob Smith", "Root")], { link: "oleafly://t1", resolution })} actions={given} canWrite />
      </CommentKitProvider>
    );
    const view = render(tree(null));
    const menu = screen.getByRole("button", { name: LABELS.messageActions });
    menu.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("menuitem", { name: LABELS.copyLink })).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(copyText).toHaveBeenCalledTimes(1));
    screen.getByRole("button", { name: LABELS.resolve }).focus();
    await user.keyboard("{Enter}");
    expect(given.resolve).not.toHaveBeenCalled();
    await act(async () => release());
    (document.activeElement as HTMLElement).blur();
    view.rerender(tree("Resolved by Alice Chen"));
    expect(document.activeElement).toBe(document.body);
  });

  it("moves focus to the reopened thread's ⋯ when Enter on Reopen unfolds it, and leaves it alone when someone else reopens", async () => {
    const user = userEvent.setup();
    const given = actions();
    const tree = (resolution: string | null) => (
      <CommentKitProvider value={kit()}>
        <CommentThread thread={model([entry("m1", "bob", "Bob Smith", "Root")], { resolution })} actions={given} canWrite />
      </CommentKitProvider>
    );
    const view = render(tree("Resolved by Alice Chen"));
    screen.getByRole("button", { name: LABELS.reopen }).focus();
    await user.keyboard("{Enter}");
    expect(given.reopen).toHaveBeenCalledTimes(1);
    view.rerender(tree(null));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: LABELS.messageActions }));
    view.unmount();

    const remote = render(tree("Resolved by Alice Chen"));
    remote.rerender(tree(null));
    expect(document.activeElement).toBe(document.body);
  });
});
