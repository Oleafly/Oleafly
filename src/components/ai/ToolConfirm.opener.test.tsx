// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const gotoLine = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false, invoke: vi.fn() }));
vi.mock("@/components/editor/cm/controller", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/editor/cm/controller")>()),
  gotoLine,
}));

import type { ToolApprovalRequest } from "@/lib/ai-tools";
import { useFilesStore } from "@/store/files";
import { ToolConfirm } from "./ToolConfirm";

afterEach(cleanup);

describe("ToolConfirm opening the file it asks about", () => {
  it("opens the file as a tab the assistant opened", async () => {
    const openFile = vi.fn(async () => {});
    useFilesStore.setState({ projectId: "project", activePath: null, openFile });
    const req = { tool: "write_file", summary: "Write notes.tex", path: "notes.tex" } as ToolApprovalRequest;

    render(<ToolConfirm req={req} onApprove={vi.fn()} onReject={vi.fn()} />);

    await vi.waitFor(() => expect(gotoLine).toHaveBeenCalledWith(1));
    expect(openFile).toHaveBeenCalledExactlyOnceWith("notes.tex", { opener: "assistant" });
  });
});
