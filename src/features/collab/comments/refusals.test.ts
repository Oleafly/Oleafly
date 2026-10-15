import { beforeAll, describe, expect, it } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import type { CollabCommentErrorCode } from "@/lib/tauri";
import { commentFailure } from "./refusals";

const CODES: CollabCommentErrorCode[] = [
  "comment_not_live",
  "comment_not_yours",
  "comment_off_server",
  "comment_off_project",
  "comment_viewer",
  "comment_someone_replied",
  "comment_message_deleted",
  "comment_selection_changed",
  "comment_too_long",
  "comment_empty",
];

beforeAll(async () => {
  await loadNamespace("collab");
});

describe("comment refusals", () => {
  it("gives every refusal its own message from the comment strings", () => {
    const refusals: Record<string, string> = enCollab.comments.refusals;
    const messages = CODES.map((code) => commentFailure({ code, message: "" }));
    expect(new Set(messages).size).toBe(CODES.length);
    for (const message of messages) expect(Object.values(refusals)).toContain(message);
  });

  it("falls back to the general collaboration messages for anything else", () => {
    expect(commentFailure({ code: "unreachable", message: "" })).toBe(enCollab.errors.unreachable);
    expect(commentFailure(new Error("boom"))).toBe(enCollab.errors.internal);
  });
});
