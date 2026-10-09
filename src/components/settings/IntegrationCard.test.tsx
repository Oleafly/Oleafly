// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ConnectedBadge,
  IntegrationBusyButton,
  IntegrationCard,
  IntegrationConnected,
  IntegrationError,
  IntegrationKeyField,
  integrationLink,
} from "./IntegrationCard";

const TITLE = "Example service";
const DESCRIPTION = "Searches an example index.";
const HINT = "Paste a key from your account page.";
const DOCS = "Read the API docs";
const CONNECTED = "Connected";
const ACTION = "Remove key";
const ERROR = "The key was rejected.";
const KEY_LABEL = "API key";
const SAVE = "Save key";
const LINK_TEXT = "example.org";
const EMAIL_PLACEHOLDER = "name@example.org";

describe("IntegrationCard", () => {
  it("renders the plain section layout used beside GitHub", () => {
    render(
      <IntegrationCard
        testId="example-section"
        title={TITLE}
        description={DESCRIPTION}
        hint={HINT}
        actions={<button type="button">{ACTION}</button>}
      >
        <IntegrationError id="example-error">{ERROR}</IntegrationError>
      </IntegrationCard>,
    );

    const card = screen.getByTestId("example-section");
    expect(card.tagName).toBe("DIV");
    expect(card).toHaveClass("space-y-2");
    expect(card).not.toHaveClass("border");
    expect(screen.getByRole("heading", { level: 3, name: TITLE })).toHaveClass("text-sm", "font-medium");
    expect(screen.getByText(DESCRIPTION)).toHaveClass("text-xs", "text-muted-foreground");
    expect(screen.getByText(DESCRIPTION)).not.toHaveClass("mt-2");
    expect(screen.getByText(HINT)).toHaveClass("mt-1");
    expect(screen.getByRole("button", { name: ACTION })).toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("id", "example-error");
    expect(alert).toHaveTextContent(ERROR);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders the framed card layout with an icon, a status badge and a docs link", () => {
    render(
      <IntegrationCard
        framed
        icon={<span data-testid="brand-icon" />}
        title={TITLE}
        badge={<ConnectedBadge label={CONNECTED} />}
        description={DESCRIPTION}
        docs={{ href: "https://example.org/docs", label: DOCS }}
      />,
    );

    const heading = screen.getByRole("heading", { level: 4, name: TITLE });
    const card = heading.closest("section");
    expect(card).toHaveClass("rounded-lg", "border", "bg-background", "p-4");
    expect(screen.getByTestId("brand-icon").nextElementSibling).toBe(heading);
    expect(screen.getByText(CONNECTED)).toHaveClass("bg-emerald-500/10", "text-[0.625rem]");
    expect(screen.getByText(DESCRIPTION)).toHaveClass("mt-2", "leading-relaxed");
    const docs = screen.getByRole("link", { name: DOCS });
    expect(docs).toHaveAttribute("href", "https://example.org/docs");
    expect(docs).toHaveAttribute("target", "_blank");
    expect(docs).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("shows a connected line with a check", () => {
    render(<IntegrationConnected testId="example-connected">{CONNECTED}</IntegrationConnected>);
    const line = screen.getByTestId("example-connected");
    expect(line).toHaveTextContent(CONNECTED);
    expect(line).toHaveClass("text-emerald-700");
    expect(line.querySelector("svg")).not.toBeNull();
  });

  it("builds an external link element for translated hints", () => {
    render(<p>{integrationLink("https://example.org")}</p>);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://example.org");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveClass("text-primary");
    expect(link.textContent).not.toBe(LINK_TEXT);
  });
});

describe("IntegrationBusyButton", () => {
  it("disables itself and shows a spinner while busy", () => {
    const onClick = vi.fn();
    const { rerender, container } = render(
      <IntegrationBusyButton busy={false} testId="action" onClick={onClick}>
        {ACTION}
      </IntegrationBusyButton>,
    );
    fireEvent.click(screen.getByTestId("action"));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".animate-spin")).toBeNull();

    rerender(
      <IntegrationBusyButton busy variant="outline" testId="action" onClick={onClick}>
        {ACTION}
      </IntegrationBusyButton>,
    );
    expect(screen.getByTestId("action")).toBeDisabled();
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });
});

describe("IntegrationKeyField", () => {
  it("only saves a non-blank value and labels the input", () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    const { rerender } = render(
      <IntegrationKeyField
        value="  "
        onChange={onChange}
        label={KEY_LABEL}
        busy={false}
        submitLabel={SAVE}
        onSubmit={onSubmit}
        inputTestId="key-input"
        submitTestId="key-save"
      />,
    );

    const input = screen.getByLabelText(KEY_LABEL);
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("placeholder", KEY_LABEL);
    expect(screen.getByTestId("key-save")).toBeDisabled();
    fireEvent.change(input, { target: { value: "abc" } });
    expect(onChange).toHaveBeenCalledWith("abc");

    rerender(
      <IntegrationKeyField
        type="email"
        value="a@b.c"
        onChange={onChange}
        label={KEY_LABEL}
        placeholder={EMAIL_PLACEHOLDER}
        busy={false}
        submitLabel={SAVE}
        onSubmit={onSubmit}
        inputTestId="key-input"
        submitTestId="key-save"
      />,
    );
    expect(screen.getByTestId("key-input")).toHaveAttribute("type", "email");
    expect(screen.getByTestId("key-input")).toHaveAttribute("placeholder", EMAIL_PLACEHOLDER);
    fireEvent.click(screen.getByRole("button", { name: SAVE }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
