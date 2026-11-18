// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MorphElement } from "./morph-element";

function Label() {
  return <span>{"Label"}</span>;
}

describe("MorphElement", () => {
  it("tags a single element child directly, merging class names and styles", () => {
    const { container } = render(
      <MorphElement id="hero" className="wide" style={{ color: "red" }}>
        <h1 className="title" style={{ margin: 0 }}>
          {"Hello"}
        </h1>
      </MorphElement>,
    );

    const heading = container.firstElementChild as HTMLElement;
    expect(heading.tagName).toBe("H1");
    expect(heading).toHaveAttribute("data-osd-morph", "hero");
    expect(heading).toHaveClass("title", "wide");
    expect(heading.style.margin).toBe("0px");
    expect(heading.style.color).toBe("red");
  });

  it("keeps the child's own class and style when it adds none", () => {
    const { container } = render(
      <MorphElement id="plain">
        <p style={{ fontWeight: 700 }}>{"Text"}</p>
      </MorphElement>,
    );

    const paragraph = container.firstElementChild as HTMLElement;
    expect(paragraph).not.toHaveAttribute("class");
    expect(paragraph.style.fontWeight).toBe("700");
  });

  it.each([
    ["a component", <Label key="label" />],
    ["several children", [<b key="a">{"A"}</b>, <i key="b">{"B"}</i>]],
    ["plain text", "Words"],
    ["nothing", null],
  ])("wraps %s in a tagged div", (_label, children) => {
    const { container } = render(
      <MorphElement id="group" className="box" style={{ padding: 4 }}>
        {children}
      </MorphElement>,
    );

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.tagName).toBe("DIV");
    expect(wrapper).toHaveAttribute("data-osd-morph", "group");
    expect(wrapper).toHaveClass("box");
    expect(wrapper.style.padding).toBe("4px");
  });
});
