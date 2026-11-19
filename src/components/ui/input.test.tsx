// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Input, LITERAL_INPUT } from "./input";
import { SearchField } from "./search-field";

function expectLiteral(input: HTMLElement) {
  expect(input).toHaveAttribute("autocorrect", "off");
  expect(input).toHaveAttribute("autocapitalize", "off");
  expect(input).toHaveAttribute("spellcheck", "false");
}

describe("Input", () => {
  it("takes search text as typed, with no autocorrect, capitals, spelling marks or autofill", () => {
    render(<Input type="search" aria-label={"Find skills"} />);
    const input = screen.getByRole("searchbox", { name: "Find skills" });
    expectLiteral(input);
    expect(input).toHaveAttribute("autocomplete", "off");
  });

  it("takes web and mail addresses as typed and leaves their autofill alone", () => {
    render(
      <>
        <Input type="url" aria-label={"Base URL"} />
        <Input type="email" aria-label={"Email"} />
      </>,
    );
    for (const name of ["Base URL", "Email"]) {
      const input = screen.getByRole("textbox", { name });
      expectLiteral(input);
      expect(input).not.toHaveAttribute("autocomplete");
    }
  });

  it("leaves prose fields to the system unless they hold an ID, path or code", () => {
    render(
      <>
        <Input aria-label={"Description"} />
        <Input {...LITERAL_INPUT} aria-label={"Model ID"} />
      </>,
    );
    const prose = screen.getByRole("textbox", { name: "Description" });
    expect(prose).not.toHaveAttribute("autocorrect");
    expect(prose).not.toHaveAttribute("spellcheck");
    expectLiteral(screen.getByRole("textbox", { name: "Model ID" }));
  });

  it("lets the caller turn spelling marks back on", () => {
    render(<Input type="search" spellCheck aria-label={"Search notes"} />);
    expect(screen.getByRole("searchbox", { name: "Search notes" })).toHaveAttribute("spellcheck", "true");
  });

  it("ends a placeholder that does not fit with an ellipsis", () => {
    render(<Input aria-label={"Name"} placeholder={"Einstellungen durchsuchen"} />);
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveClass("placeholder-shown:text-ellipsis");
  });
});

describe("SearchField", () => {
  it("takes the filter text as typed and ends a long placeholder with an ellipsis", () => {
    render(<SearchField value="" onChange={() => undefined} label={"Filter logs"} placeholder={"Search the logs"} />);
    const input = screen.getByRole("searchbox", { name: "Filter logs" });
    expectLiteral(input);
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveClass("placeholder-shown:text-ellipsis");
  });
});
