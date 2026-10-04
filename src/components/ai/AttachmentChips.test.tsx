// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AttachmentChips } from "./AttachmentChips";

describe("AttachmentChips", () => {
  it("renders nothing without attachments", () => {
    const { container } = render(<AttachmentChips items={[]} onRemove={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("previews images, names other files and removes the one clicked", () => {
    const onRemove = vi.fn();
    render(
      <AttachmentChips
        items={[
          { id: "a", name: "plot.png", mediaType: "image/png", dataUrl: "data:image/png;base64,AA" },
          { id: "b", name: "notes.txt", mediaType: "text/plain", dataUrl: "data:text/plain;base64,AA" },
        ]}
        onRemove={onRemove}
      />,
    );

    expect(screen.getByRole("img", { name: "plot.png" })).toHaveAttribute("src", "data:image/png;base64,AA");
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove notes.txt" }));

    expect(onRemove).toHaveBeenCalledWith("b");
  });
});
