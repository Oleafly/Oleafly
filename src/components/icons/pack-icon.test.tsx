// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { Folder } from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";
import { COLOR_ICON_PREVIEW } from "@/components/settings/icon-pack-preview";
import { parseIconPack } from "@/lib/icon-pack-install";
import { setIconPack, setInstalledIconPack } from "./icon-pack";
import { IconPackHost, packIcon } from "./pack-icon";

const PackFolder = packIcon(Folder, "folder", "lucide-folder");
const OnlyInColor = packIcon(null, "search");
const installed = () => parseIconPack(COLOR_ICON_PREVIEW);

afterEach(() => {
  act(() => {
    setInstalledIconPack(null);
    setIconPack("neutral");
  });
});

describe("pack icons", () => {
  it("draws the Lucide icon, and nothing for a colour-only icon, while Neutral is showing", () => {
    const { container } = render(
      <>
        <PackFolder className="size-4" />
        <OnlyInColor />
      </>,
    );
    const svgs = container.querySelectorAll("svg");
    expect(svgs).toHaveLength(1);
    expect(svgs[0]).toHaveClass("lucide-folder", "size-4");
  });

  it("switches to the colour drawing, keeping the Lucide class names, once Color is installed and picked", () => {
    const { container } = render(<PackFolder className="size-4" />);
    act(() => {
      setInstalledIconPack(installed());
      setIconPack("color");
    });
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("data-oleafly-icon", "folder");
    expect(svg).toHaveClass("oi", "lucide-folder", "size-4");
    expect(svg).toHaveAttribute("viewBox", "0 0 20 20");
    expect(document.documentElement.dataset.iconPack).toBe("color");
  });

  it("keeps the Lucide icon when Color is picked but not installed", () => {
    act(() => setIconPack("color"));
    const { container } = render(<PackFolder />);
    expect(container.querySelector("svg")).toHaveClass("lucide-folder");
    expect(document.documentElement.dataset.iconPack).toBe("neutral");
  });
});

describe("icon pack host", () => {
  it("mounts the pack's styles and gradients only while Color is showing", () => {
    const { container } = render(<IconPackHost />);
    expect(container.querySelector("style")).toBeNull();
    act(() => {
      setInstalledIconPack(installed());
      setIconPack("color");
    });
    expect(container.querySelector('style[data-icon-pack="color"]')?.textContent).toContain(".oi .o");
    expect(container.querySelector("defs linearGradient")).not.toBeNull();
  });
});
