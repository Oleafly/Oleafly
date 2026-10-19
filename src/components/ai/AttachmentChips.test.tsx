// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/ai.json" with { type: "json" };
import type { ComposerAttachment } from "@/components/ai/composer/types";
import { AttachmentChips } from "./AttachmentChips";

function item(patch: Partial<ComposerAttachment>): ComposerAttachment {
  return { id: "a", name: "plot.png", mime: "image/png", size: 2048, status: "ready", ...patch };
}

describe("AttachmentChips", () => {
  it("renders nothing without attachments", () => {
    const { container } = render(<AttachmentChips items={[]} onRemove={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows thumbnails, file icons, sizes and page counts", () => {
    const { container } = render(
      <AttachmentChips
        items={[
          item({ thumbnailUrl: "data:image/jpeg;base64,AA" }),
          item({ id: "b", name: "notes.txt", mime: "text/plain", size: 10 }),
          item({ id: "c", name: "paper.pdf", mime: "application/pdf", pages: 240, size: 4096 }),
        ]}
      />,
    );
    expect(container.querySelector("img")).toHaveAttribute("src", "data:image/jpeg;base64,AA");
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
    // The size line; the note below it names the page count too.
    expect(screen.getByText("4 KB · 240 pages")).toBeInTheDocument();
    expect(
      screen.getByText(
        en.attachments.pagesLimited.replace("{{limit}}", "100").replace("{{count}}", "240"),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("marks a preparing attachment busy and an errored one with its message", () => {
    render(
      <AttachmentChips
        items={[
          item({ status: "processing" }),
          item({ id: "b", name: "photo.heic", status: "error", error: "Cannot read it." }),
        ]}
        onRemove={vi.fn()}
      />,
    );
    const chips = screen.getAllByTestId("composer-attachment");
    expect(chips[0]).toHaveAttribute("data-status", "processing");
    expect(chips[0]).toHaveAttribute("aria-busy", "true");
    expect(chips[0]).toHaveTextContent(en.attachments.processing.replace("{{name}}", "plot.png"));
    expect(chips[1]).toHaveAttribute("data-status", "error");
    expect(chips[1].className).toContain("border-destructive/50");
  });

  it("removes the one clicked", () => {
    const onRemove = vi.fn();
    render(
      <AttachmentChips
        items={[item({}), item({ id: "b", name: "notes.txt", mime: "text/plain" })]}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove notes.txt" }));
    expect(onRemove).toHaveBeenCalledWith("b");
  });
});
