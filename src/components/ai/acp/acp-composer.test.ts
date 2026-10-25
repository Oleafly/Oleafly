import { describe, expect, it } from "vitest";
import { buildMentionEntries } from "@/components/ai/MentionMenu";
import { session } from "./tests/ui-fixtures";
import { acpAttachmentKinds, acpMentionItems, acpSlashItems, composerMode } from "./acp-composer";

const groups = { commands: "Agent commands", skills: "Skills" };

describe("CLI composer helpers", () => {
  it("starts, sends, queues or blocks by session state", () => {
    expect(composerMode(undefined, true)).toBe("start");
    expect(composerMode(undefined, false)).toBe("blocked");
    expect(composerMode(session("s", { status: "ready" }), true)).toBe("send");
    for (const status of ["connecting", "running", "cancelling"] as const) {
      expect(composerMode(session("s", { status }), true)).toBe("queue");
    }
    for (const status of ["auth_required", "disconnected", "cancelled", "failed"] as const) {
      expect(composerMode(session("s", { status }), true)).toBe("blocked");
    }
  });

  it("queues behind a message that is still on its way to the agent", () => {
    expect(composerMode(session("s", { status: "ready" }), true, true)).toBe("queue");
    expect(composerMode(session("s", { status: "running" }), true, true)).toBe("queue");
    expect(composerMode(session("s", { status: "failed" }), true, true)).toBe("blocked");
    expect(composerMode(undefined, true, true)).toBe("start");
  });

  it("lists only the commands the agent advertised, then skills", () => {
    const items = acpSlashItems(
      [
        { name: "plan", description: "Plan the work", hint: null },
        { name: "review", description: "", hint: null },
      ],
      [
        { id: "oleafly-literature-sweep", name: "Literature sweep", description: "Find related papers" },
        { id: "broken", name: "Broken skill", valid: false },
        { id: "elsewhere", name: "Not here", available: false },
      ],
      groups,
    );
    expect(items.map((item) => item.label)).toEqual(["/plan", "/review", "Literature sweep"]);
    expect(items[0]).toMatchObject({
      id: "command:plan",
      insertText: "/plan ",
      command: "plan",
      description: "Plan the work",
      group: "Agent commands",
    });
    expect(items[1].description).toBeUndefined();
    expect(items[2]).toMatchObject({ id: "skill:oleafly-literature-sweep", insertText: "", group: "Skills" });
  });

  it("shows a command's input hint", () => {
    const [item] = acpSlashItems([{ name: "model", description: "Switch model", hint: "model name" }], [], groups);
    expect(item.hint).toBe("model name");
    const [plain] = acpSlashItems([{ name: "clear", description: "Clear", hint: null }], [], groups);
    expect(plain.hint).toBeUndefined();
  });

  it("offers images only to agents that accept them", () => {
    expect(acpAttachmentKinds(undefined)).toEqual(["image", "pdf", "text"]);
    const withImages = session("s");
    withImages.capabilities = { ...withImages.capabilities, image: true };
    expect(acpAttachmentKinds(withImages)).toEqual(["image", "pdf", "text"]);
    expect(acpAttachmentKinds(session("s"))).toEqual(["pdf", "text"]);
  });

  it("maps tree entries to file and folder mentions", () => {
    const entries = buildMentionEntries([
      { path: "chapters", is_dir: true },
      { path: "chapters/intro.tex", is_dir: false },
      { path: "main.tex", is_dir: false },
    ]);
    const items = acpMentionItems(entries, "intro");
    expect(items).toEqual([
      { id: "chapters/intro.tex", label: "intro.tex", kind: "file", path: "chapters/intro.tex", detail: "chapters" },
    ]);
    const all = acpMentionItems(entries, "");
    expect(all).toContainEqual({ id: "chapters", label: "chapters", kind: "folder", path: "chapters", detail: undefined });
    expect(all).toContainEqual({ id: "main.tex", label: "main.tex", kind: "file", path: "main.tex", detail: undefined });
  });
});
