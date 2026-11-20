// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import enPreview from "@/i18n/locales/en/preview.json" with { type: "json" };

const tauri = vi.hoisted(() => ({
  projectFileSizes: vi.fn<(projectId: string, paths: readonly string[]) => Promise<Record<string, number>>>(),
  readProjectBytes: vi.fn<(projectId: string, path: string) => Promise<ArrayBuffer>>(),
  readFileBase64: vi.fn<(projectId: string, path: string) => Promise<string>>(),
}));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  projectFileSizes: tauri.projectFileSizes,
  readProjectBytes: tauri.readProjectBytes,
  readFileBase64: tauri.readFileBase64,
}));
const log = vi.hoisted(() => ({ logError: vi.fn(async () => {}), logWarning: vi.fn(async () => {}) }));
vi.mock("@/lib/log", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/log")>()), ...log }));

import { clampImageScale, IMAGE_DIRECT_READ_BYTES, IMAGE_MAX_BYTES, IMAGE_MAX_SCALE, IMAGE_MIN_SCALE, ImageFileView } from "./ImageFileView";

const zoom = enPreview.zoom;
const percent = (value: number) => zoom.percent.replace("{{percent}}", String(value));

const urls = { made: 0, revoked: [] as string[] };
const nativeUrls = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };

beforeEach(() => {
  urls.made = 0;
  urls.revoked = [];
  URL.createObjectURL = () => `blob:image-${++urls.made}`;
  URL.revokeObjectURL = (url: string) => void urls.revoked.push(url);
  tauri.projectFileSizes.mockImplementation(async (_id, paths) => Object.fromEntries(paths.map((path) => [path, 12])));
  tauri.readProjectBytes.mockResolvedValue(new Uint8Array([137, 80, 78, 71]).buffer);
  tauri.readFileBase64.mockResolvedValue("iVBORw==");
});

async function loaded(path: string) {
  const image = await screen.findByAltText(path.split("/").at(-1) ?? path);
  Object.defineProperty(image, "naturalWidth", { configurable: true, value: 400 });
  fireEvent.load(image);
  return image;
}

async function shown(path = "figures/plot.png") {
  render(<ImageFileView projectId="p1" path={path} />);
  return loaded(path);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  URL.createObjectURL = nativeUrls.create;
  URL.revokeObjectURL = nativeUrls.revoke;
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
    tauri.readProjectBytes.mockRejectedValue("denied");
    render(<ImageFileView projectId="p1" path="a.png" />);
    expect(await screen.findByText(enEditor.shell.imageLoadFailed.replace("{{detail}}", "denied"))).toBeInTheDocument();
    expect(log.logError).toHaveBeenCalledWith("open an image", "denied");
    cleanup();

    tauri.readProjectBytes.mockResolvedValue(new Uint8Array([0, 0, 0]).buffer);
    render(<ImageFileView projectId="p1" path="b.png" />);
    fireEvent.error(await screen.findByAltText("b.png"));
    expect(screen.getByTestId("image-undecodable")).toBeInTheDocument();
    expect(log.logWarning).toHaveBeenCalledWith("show an image", "b.png");
  });

  it("starts the next image at fit instead of the zoom of the one before", async () => {
    const { rerender } = render(<ImageFileView projectId="p1" path="figures/first.png" />);
    await loaded("figures/first.png");
    fireEvent.click(screen.getByRole("button", { name: zoom.in }));
    expect(screen.getByText(percent(125))).toBeInTheDocument();

    rerender(<ImageFileView projectId="p1" path="figures/second.png" />);
    const second = await loaded("figures/second.png");
    expect(second).toHaveClass("object-contain");
    expect(screen.getByRole("button", { name: enEditor.shell.imageFit })).toBeDisabled();
  });

  it("checks the size first and does not read an image over the limit", async () => {
    tauri.projectFileSizes.mockResolvedValue({ "scans/huge.png": IMAGE_MAX_BYTES + 1 });
    render(<ImageFileView projectId="p1" path="scans/huge.png" />);
    expect(await screen.findByText(enEditor.shell.imageTooLarge.replace("{{limit}}", "64 MB"))).toBeInTheDocument();
    expect(tauri.projectFileSizes).toHaveBeenCalledWith("p1", ["scans/huge.png"]);
    expect(tauri.readProjectBytes).not.toHaveBeenCalled();
    expect(tauri.readFileBase64).not.toHaveBeenCalled();
    expect(log.logError).not.toHaveBeenCalled();
  });

  it("still opens an image too big for the direct read, the slower way", async () => {
    tauri.projectFileSizes.mockResolvedValue({ "scans/poster.png": IMAGE_DIRECT_READ_BYTES + 1 });
    const image = await shown("scans/poster.png");
    expect(image).toHaveAttribute("src", "blob:image-1");
    expect(tauri.readFileBase64).toHaveBeenCalledWith("p1", "scans/poster.png");
    expect(tauri.readProjectBytes).not.toHaveBeenCalled();
  });

  it("shows the image from a blob address and gives the address back when it closes", async () => {
    const image = await shown("figures/kept.png");
    expect(image).toHaveAttribute("src", "blob:image-1");
    expect(tauri.readProjectBytes).toHaveBeenCalledWith("p1", "figures/kept.png");
    expect(urls.revoked).toEqual([]);
    cleanup();
    expect(urls.revoked).toEqual(["blob:image-1"]);
  });
});
