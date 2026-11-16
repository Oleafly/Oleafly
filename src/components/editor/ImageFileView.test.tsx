// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import enPreview from "@/i18n/locales/en/preview.json" with { type: "json" };

const tauri = vi.hoisted(() => ({ readFileBase64: vi.fn() }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  readFileBase64: tauri.readFileBase64,
}));

import { clampImageScale, IMAGE_MAX_SCALE, IMAGE_MIN_SCALE, ImageFileView } from "./ImageFileView";

const zoom = enPreview.zoom;
const percent = (value: number) => zoom.percent.replace("{{percent}}", String(value));

async function shown(path = "figures/plot.png") {
  tauri.readFileBase64.mockResolvedValue("iVBORw0KGgo=");
  render(<ImageFileView projectId="p1" path={path} />);
  const image = await screen.findByAltText(path.split("/").at(-1) ?? path);
  Object.defineProperty(image, "naturalWidth", { configurable: true, value: 400 });
  fireEvent.load(image);
  return image;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("clampImageScale", () => {
  it("keeps the scale between the smallest and largest zoom", () => {
    expect(clampImageScale(0)).toBe(IMAGE_MIN_SCALE);
    expect(clampImageScale(99)).toBe(IMAGE_MAX_SCALE);
    expect(clampImageScale(2)).toBe(2);
  });
});

describe("ImageFileView", () => {
  it("fits the image first, then zooms in and out from there and back to fit", async () => {
    const image = await shown();
    expect(image).toHaveClass("object-contain");
    expect(screen.getByRole("button", { name: enEditor.shell.imageFit })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: zoom.in }));
    expect(screen.getByText(percent(125))).toBeInTheDocument();
    expect(screen.getByAltText("plot.png")).toHaveStyle({ width: "500px" });

    fireEvent.click(screen.getByRole("button", { name: zoom.out }));
    fireEvent.click(screen.getByRole("button", { name: zoom.out }));
    expect(screen.getByText(percent(80))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: enEditor.shell.imageFit }));
    expect(screen.getByAltText("plot.png")).toHaveClass("object-contain");
  });

  it("compounds quick clicks instead of repeating the first step", async () => {
    await shown("figures/quick.png");
    const zoomIn = screen.getByRole("button", { name: zoom.in });
    act(() => {
      zoomIn.click();
      zoomIn.click();
    });
    expect(screen.getByText(percent(156))).toBeInTheDocument();
  });

  it("zooms with a pinch or a Ctrl-scroll and leaves plain scrolling alone", async () => {
    await shown();
    const viewport = screen.getByTestId("image-viewport");
    const plain = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
    act(() => {
      viewport.dispatchEvent(plain);
    });
    expect(plain.defaultPrevented).toBe(false);
    const pinch = new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      viewport.dispatchEvent(pinch);
    });
    expect(pinch.defaultPrevented).toBe(true);
    expect(screen.getByText(percent(272))).toBeInTheDocument();
  });

  it("remembers each image's zoom when it is opened again", async () => {
    await shown("figures/remembered.png");
    fireEvent.click(screen.getByRole("button", { name: zoom.in }));
    cleanup();
    await shown("figures/remembered.png");
    expect(screen.getByText(percent(125))).toBeInTheDocument();
  });

  it("explains an image that cannot be read or decoded", async () => {
    tauri.readFileBase64.mockRejectedValue("denied");
    render(<ImageFileView projectId="p1" path="a.png" />);
    expect(await screen.findByText(enEditor.shell.imageLoadFailed.replace("{{detail}}", "denied"))).toBeInTheDocument();
    cleanup();

    tauri.readFileBase64.mockResolvedValue("AAAA");
    render(<ImageFileView projectId="p1" path="b.png" />);
    fireEvent.error(await screen.findByAltText("b.png"));
    expect(screen.getByTestId("image-undecodable")).toBeInTheDocument();
  });
});
