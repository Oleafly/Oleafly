// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/ai.json" with { type: "json" };

const mocks = vi.hoisted(() => ({
  attachmentObjectUrl: vi.fn(),
  attachmentRead: vi.fn(),
  pickSavePath: vi.fn(),
  writeBytesFile: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/attachments", () => ({
  attachmentObjectUrl: mocks.attachmentObjectUrl,
  attachmentRead: mocks.attachmentRead,
}));
vi.mock("@/lib/native-file-dialog", () => ({ pickSavePath: mocks.pickSavePath }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  writeBytesFile: mocks.writeBytesFile,
}));
vi.mock("@/lib/toast", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

import { useFilesStore } from "@/store/files";
import MessageAttachments from "./MessageAttachments";

beforeAll(async () => {
  const { initTestI18n } = await import("@/components/ai/acp/tests/ui-fixtures");
  await initTestI18n();
});

beforeEach(() => {
  vi.clearAllMocks();
  useFilesStore.setState({ projectId: "p1" });
});

describe("MessageAttachments", () => {
  it("shows image thumbnails from the attachment store and opens a preview", async () => {
    mocks.attachmentObjectUrl.mockResolvedValue("blob:plot");
    render(<MessageAttachments attachments={[{ name: "plot.png", mediaType: "image/png", sha256: "s", kind: "image" }]} />);
    const open = screen.getByRole("button", { name: en.attachments.open.replace("{{name}}", "plot.png") });
    await waitFor(() => expect(open).not.toBeDisabled());
    fireEvent.click(open);
    expect(await screen.findByTestId("attachment-preview")).toBeInTheDocument();
  });

  it("shows page counts for PDFs", () => {
    render(
      <MessageAttachments
        attachments={[{ name: "paper.pdf", mediaType: "application/pdf", sha256: "p", kind: "pdf", pages: 12, size: 2048 }]}
      />,
    );
    expect(screen.getByTestId("message-attachment")).toHaveTextContent("12 pages");
  });

  it("saves a copy of a PDF through the save dialog", async () => {
    mocks.pickSavePath.mockResolvedValue("/tmp/paper.pdf");
    mocks.attachmentRead.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
    render(<MessageAttachments attachments={[{ name: "paper.pdf", mediaType: "application/pdf", sha256: "p", kind: "pdf" }]} />);
    fireEvent.click(screen.getByRole("button", { name: en.attachments.saveCopy.replace("{{name}}", "paper.pdf") }));
    await waitFor(() => expect(mocks.writeBytesFile).toHaveBeenCalledWith("/tmp/paper.pdf", "AQID"));
    expect(mocks.success).toHaveBeenCalled();
  });

  it("dims an attachment that is no longer available", async () => {
    mocks.attachmentObjectUrl.mockRejectedValue(new Error("gone"));
    render(<MessageAttachments attachments={[{ name: "plot.png", mediaType: "image/png", sha256: "s", kind: "image" }]} />);
    await waitFor(() => expect(screen.getByTestId("message-attachment")).toHaveAttribute("data-state", "missing"));
  });
});
