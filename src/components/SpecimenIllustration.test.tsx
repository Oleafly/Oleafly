// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import enShell from "@/i18n/locales/en/shell.json" with { type: "json" };
import { SpecimenIllustration } from "./SpecimenIllustration";

const specimen = enShell.errorBoundary.specimen;

describe("SpecimenIllustration", () => {
  it("draws a labelled decorative diagram with translated captions", () => {
    render(<SpecimenIllustration />);

    const diagram = screen.getByRole("img", { name: specimen.diagramLabel });
    expect(diagram.querySelectorAll("line").length).toBeGreaterThan(26);
    expect(screen.getByText(specimen.specimen)).toBeInTheDocument();
    expect(screen.getByText(specimen.veinDensity)).toBeInTheDocument();
    expect(screen.getByText(specimen.transversePlane)).toBeInTheDocument();
    expect(
      screen.getByText(specimen.layer.replace("{{current}}", "9").replace("{{total}}", "15")),
    ).toBeInTheDocument();
  });
});
