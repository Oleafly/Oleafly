// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyIntro, EmptyState, ErrorState, LoadingState } from "./empty";

const TITLE = "No checkpoints yet";
const DESCRIPTION = "A checkpoint appears after the first compile.";
const ACTION = "Try again";
const LOADING = "Loading checkpoints";
const FAILED = "Could not load checkpoints.";
const EYEBROW = "Getting started";
const HEADING = "Search the literature";
const BODY = "Type a topic to begin.";

describe("EmptyState", () => {
  it("stacks the icon, the text and the actions in the centre", () => {
    render(
      <EmptyState
        testId="empty"
        className="min-h-44"
        icon={<span data-testid="empty-icon" />}
        title={TITLE}
        description={DESCRIPTION}
      >
        <button type="button">{ACTION}</button>
      </EmptyState>,
    );

    const root = screen.getByTestId("empty");
    expect(root).toHaveClass("flex-col", "items-center", "justify-center", "gap-3", "text-center", "min-h-44");
    expect(root.firstElementChild).toBe(screen.getByTestId("empty-icon"));
    expect(screen.getByText(TITLE)).toHaveClass("text-sm", "font-medium");
    expect(screen.getByText(DESCRIPTION)).toHaveClass("mt-1", "max-w-sm", "text-xs");
    expect(root.lastElementChild).toBe(screen.getByRole("button", { name: ACTION }));
  });

  it("uses the smaller sidebar type at the compact size and skips missing text", () => {
    const { rerender } = render(
      <EmptyState testId="empty" size="compact" title={TITLE} description={DESCRIPTION} />,
    );
    expect(screen.getByText(TITLE)).toHaveClass("text-xs");
    expect(screen.getByText(DESCRIPTION)).toHaveClass("text-[0.6875rem]");

    rerender(<EmptyState testId="empty" icon={<span data-testid="empty-icon" />} />);
    expect(screen.getByTestId("empty").children).toHaveLength(1);
  });
});

describe("LoadingState", () => {
  it("announces a spinning label", () => {
    const { container } = render(<LoadingState id="loading" testId="loading" label={LOADING} />);
    const status = screen.getByRole("status");
    expect(status).toBe(screen.getByTestId("loading"));
    expect(status).toHaveAttribute("id", "loading");
    expect(status).toHaveTextContent(LOADING);
    expect(status).toHaveClass("text-sm", "text-muted-foreground", "gap-2");
    expect(container.querySelector("svg")).toHaveClass("animate-spin", "size-4");
  });

  it("shrinks the text and the spinner at the compact size", () => {
    const { container } = render(
      <LoadingState size="compact" className="justify-center" label={LOADING} />,
    );
    expect(screen.getByRole("status")).toHaveClass("text-xs", "justify-center");
    expect(container.querySelector("svg")).toHaveClass("size-3.5");
  });
});

describe("ErrorState", () => {
  it("raises an alert with the message and its recovery action", () => {
    render(
      <ErrorState message={FAILED}>
        <button type="button">{ACTION}</button>
      </ErrorState>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveClass("items-start", "gap-3");
    expect(screen.getByText(FAILED)).toHaveClass("text-sm", "text-destructive");
    expect(alert).toContainElement(screen.getByRole("button", { name: ACTION }));
  });

  it("takes the compact text size and a centring override", () => {
    render(<ErrorState size="compact" className="items-center" message={FAILED} />);
    expect(screen.getByRole("alert")).toHaveClass("items-center");
    expect(screen.getByRole("alert")).not.toHaveClass("items-start");
    expect(screen.getByText(FAILED)).toHaveClass("text-xs");
  });
});

describe("EmptyIntro", () => {
  it("renders the tool eyebrow, heading and body", () => {
    const { container } = render(
      <EmptyIntro className="mx-auto" eyebrow={EYEBROW} title={HEADING} description={BODY} />,
    );
    expect(container.firstElementChild).toHaveClass("mx-auto");
    expect(screen.getByText(EYEBROW)).toHaveClass("uppercase", "tracking-[0.18em]", "text-primary");
    expect(screen.getByRole("heading", { level: 2, name: HEADING })).toHaveClass("text-2xl");
    expect(screen.getByText(BODY)).toHaveClass("mt-3", "text-base");
  });

  it("omits the body when there is none", () => {
    const { container } = render(<EmptyIntro eyebrow={EYEBROW} title={HEADING} />);
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });
});
