// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Surface } from "./surface";

describe("Surface", () => {
  it("renders the base level on the primary surface token", () => {
    const { container } = render(<Surface>content</Surface>);
    const el = container.firstElementChild;
    expect(el).toHaveClass("bg-surface");
    expect(el).toHaveTextContent("content");
  });

  it("renders raised and overlay levels on the secondary surface with a border", () => {
    const { container: raised } = render(<Surface level="raised">x</Surface>);
    expect(raised.firstElementChild).toHaveClass("bg-surface-secondary", "border");

    const { container: overlay } = render(<Surface level="overlay">x</Surface>);
    expect(overlay.firstElementChild).toHaveClass(
      "bg-surface-secondary",
      "border",
      "shadow-lg",
    );
  });

  it("supports inset padding and custom classes", () => {
    const { container } = render(
      <Surface inset className="custom">
        x
      </Surface>,
    );
    expect(container.firstElementChild).toHaveClass("p-3", "custom");
  });

  it("can render as another element via asChild", () => {
    const { container } = render(
      <Surface asChild level="raised">
        <section>x</section>
      </Surface>,
    );
    expect(container.querySelector("section")).toHaveClass("bg-surface-secondary");
  });
});
