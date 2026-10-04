// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProviderLogo } from "./ProviderLogo";

describe("ProviderLogo", () => {
  it("draws the brand mark for a known provider instead of a letter", () => {
    const { container } = render(<ProviderLogo providerId="openai" />);

    expect(container.querySelector("span")).toBeNull();
  });

  it("draws a stable coloured letter tile for a custom provider", () => {
    const first = render(<ProviderLogo providerId="lab-llm" size={20} />);
    const tile = first.container.querySelector("span") as HTMLElement;
    const second = render(<ProviderLogo providerId="lab-llm" />);

    expect(tile).toHaveTextContent("L");
    expect(tile.style.width).toBe("20px");
    expect(tile.style.fontSize).toBe("12px");
    expect(tile.style.background).not.toBe("");
    expect((second.container.querySelector("span") as HTMLElement).style.background).toBe(tile.style.background);
  });

  it("uses a question mark when the provider id is blank", () => {
    const { container } = render(<ProviderLogo providerId="   " />);

    expect(container.querySelector("span")).toHaveTextContent("?");
  });
});
