import { describe, expect, it, beforeEach } from "vitest";
import { useMcpApprovalStore } from "@/store/mcp-approvals";

const req = (tool: string) => ({ tool, summary: `${tool} something` });

describe("mcp approval store", () => {
  beforeEach(() => {
    useMcpApprovalStore.setState({ queue: [], sessionAutoApprove: false });
  });

  it("queues a request and resolves true on approve", async () => {
    const p = useMcpApprovalStore.getState().request(req("write_file"));
    const q = useMcpApprovalStore.getState().queue;
    expect(q).toHaveLength(1);
    useMcpApprovalStore.getState().decide(q[0].id, true);
    await expect(p).resolves.toBe(true);
    expect(useMcpApprovalStore.getState().queue).toHaveLength(0);
  });

  it("resolves false on reject", async () => {
    const p = useMcpApprovalStore.getState().request(req("delete_file"));
    const id = useMcpApprovalStore.getState().queue[0].id;
    useMcpApprovalStore.getState().decide(id, false);
    await expect(p).resolves.toBe(false);
  });

  it("session auto-approve short-circuits writes but never deletes", async () => {
    useMcpApprovalStore.getState().setSessionAutoApprove(true);
    await expect(useMcpApprovalStore.getState().request(req("write_file"))).resolves.toBe(true);
    expect(useMcpApprovalStore.getState().queue).toHaveLength(0);
    const p = useMcpApprovalStore.getState().request(req("delete_file"));
    expect(useMcpApprovalStore.getState().queue).toHaveLength(1);
    useMcpApprovalStore.getState().decide(useMcpApprovalStore.getState().queue[0].id, false);
    await expect(p).resolves.toBe(false);
  });

  it("approveSession approves the request and turns on session auto-approve", async () => {
    const p = useMcpApprovalStore.getState().request(req("replace_in_file"));
    useMcpApprovalStore.getState().approveSession(useMcpApprovalStore.getState().queue[0].id);
    await expect(p).resolves.toBe(true);
    expect(useMcpApprovalStore.getState().sessionAutoApprove).toBe(true);
  });

  it("queues concurrent requests in order", async () => {
    const s = useMcpApprovalStore.getState();
    const p1 = s.request(req("write_file"));
    const p2 = s.request(req("rename_file"));
    const q = useMcpApprovalStore.getState().queue;
    expect(q.map((x) => x.req.tool)).toEqual(["write_file", "rename_file"]);
    useMcpApprovalStore.getState().decide(q[0].id, true);
    useMcpApprovalStore.getState().decide(q[1].id, false);
    await expect(p1).resolves.toBe(true);
    await expect(p2).resolves.toBe(false);
  });

  it("cancels every pending approval and clears session approval", async () => {
    useMcpApprovalStore.getState().setSessionAutoApprove(true);
    const pending = useMcpApprovalStore.getState().request(req("delete_file"));
    expect(useMcpApprovalStore.getState().queue).toHaveLength(1);

    useMcpApprovalStore.getState().cancelAll();

    await expect(pending).resolves.toBe(false);
    expect(useMcpApprovalStore.getState().queue).toEqual([]);
    expect(useMcpApprovalStore.getState().sessionAutoApprove).toBe(false);
  });
});
