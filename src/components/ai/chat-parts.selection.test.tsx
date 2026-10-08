// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MessageItem, ReasoningBlock } from "./chat-parts";

const REPLY = "The bibliography needs a `\\printbibliography` call.";

describe("assistant message text selection", () => {
  it("lets the reader select a reply and scopes Select All to it", async () => {
    render(<MessageItem msg={{ role: "assistant", content: REPLY }} />);

    const body = (await screen.findByText(/The bibliography needs a/)).closest("[data-select-all-scope]");

    expect(body).not.toBeNull();
    expect(body).toHaveClass("select-text");
  });

  it("lets the reader select what they sent", () => {
    render(<MessageItem msg={{ role: "user", content: "Why does biber fail?" }} />);

    const body = screen.getByText("Why does biber fail?").closest("[data-select-all-scope]");

    expect(body).toHaveClass("select-text");
  });

  it("keeps the timestamp and copy button outside the selectable body", () => {
    render(<MessageItem msg={{ role: "assistant", content: "Done.", createdAt: Date.UTC(2026, 9, 7, 12) }} />);

    const time = document.querySelector("time");

    expect(time?.closest(".select-text")).toBeNull();
  });

  it("lets the reader select an open reasoning trace", () => {
    render(<ReasoningBlock text="Check the log for undefined references." />);

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("Check the log for undefined references.").closest(".select-text")).not.toBeNull();
  });
});
