// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Field } from "./field";
import { Input } from "./input";

describe("Field", () => {
  it("names the control it holds, or heads a group of controls that name themselves", () => {
    const { rerender } = render(
      <Field id="snippet-name" label={"Name"}>
        <Input id="snippet-name" />
      </Field>,
    );
    expect(screen.getByRole("textbox", { name: "Name" })).toBeInTheDocument();

    rerender(
      <Field label={"Expands"}>
        <button type="button">{"Tab"}</button>
      </Field>,
    );
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("Expands").tagName).toBe("DIV");
    expect(screen.getByRole("button", { name: "Tab" }).parentElement).toBe(screen.getByText("Expands").parentElement);
  });
});
