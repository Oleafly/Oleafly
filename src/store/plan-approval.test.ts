// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { planApprovalForChat, usePlanApprovalStore } from "./plan-approval";

beforeEach(() => {
  localStorage.clear();
  usePlanApprovalStore.setState({ byChat: {}, loaded: {} });
});

describe("plan approval store", () => {
  it("starts every chat in the planning state", () => {
    expect(planApprovalForChat({}, "chat-a")).toBe("planning");
    expect(usePlanApprovalStore.getState().status("chat-a")).toBe("planning");
    expect(usePlanApprovalStore.getState().status(null)).toBe("planning");
  });

  it("moves one chat from planning to awaiting to approved and back without touching another chat", () => {
    const store = usePlanApprovalStore.getState();
    store.setStatus("chat-a", "awaiting");
    expect(usePlanApprovalStore.getState().status("chat-a")).toBe("awaiting");
    expect(usePlanApprovalStore.getState().status("chat-b")).toBe("planning");

    store.setStatus("chat-a", "approved");
    expect(usePlanApprovalStore.getState().status("chat-a")).toBe("approved");

    store.setStatus("chat-a", "planning");
    expect(usePlanApprovalStore.getState().status("chat-a")).toBe("planning");
    expect(localStorage.getItem("oleafly.plan-approval.chat-a")).toBeNull();
  });

  it("keeps a revised plan awaiting approval", () => {
    const store = usePlanApprovalStore.getState();
    store.setStatus("chat-a", "awaiting");
    store.setStatus("chat-a", "awaiting");
    expect(usePlanApprovalStore.getState().status("chat-a")).toBe("awaiting");
  });

  it("reloads the persisted state for a chat", () => {
    usePlanApprovalStore.getState().setStatus("chat-a", "awaiting");
    usePlanApprovalStore.setState({ byChat: {}, loaded: {} });

    expect(usePlanApprovalStore.getState().load("chat-a")).toBe("awaiting");
    expect(usePlanApprovalStore.getState().status("chat-a")).toBe("awaiting");
  });

  it("ignores unknown persisted values", () => {
    localStorage.setItem("oleafly.plan-approval.chat-a", "garbage");
    expect(usePlanApprovalStore.getState().load("chat-a")).toBe("planning");
  });

  it("discards the pending approvals of the listed chats and leaves another project's chat alone", () => {
    const store = usePlanApprovalStore.getState();
    store.setStatus("chat-a", "awaiting");
    store.setStatus("chat-b", "approved");
    store.setStatus("other-project-chat", "awaiting");
    localStorage.setItem("oleafly.plan-mode.project-1", "1");

    usePlanApprovalStore.getState().discardForChats(["chat-a", "chat-b"]);

    expect(usePlanApprovalStore.getState().status("chat-a")).toBe("planning");
    expect(usePlanApprovalStore.getState().status("chat-b")).toBe("planning");
    expect(usePlanApprovalStore.getState().status("other-project-chat")).toBe("awaiting");
    expect(localStorage.getItem("oleafly.plan-approval.chat-a")).toBeNull();
    expect(localStorage.getItem("oleafly.plan-approval.chat-b")).toBeNull();
    expect(localStorage.getItem("oleafly.plan-approval.other-project-chat")).toBe("awaiting");
    expect(localStorage.getItem("oleafly.plan-mode.project-1")).toBe("1");
  });

  it("changes nothing when no chat ids are given", () => {
    usePlanApprovalStore.getState().setStatus("chat-a", "awaiting");

    usePlanApprovalStore.getState().discardForChats([]);

    expect(usePlanApprovalStore.getState().status("chat-a")).toBe("awaiting");
  });
});
