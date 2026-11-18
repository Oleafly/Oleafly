// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import { useFilesStore } from "@/store/files";

const tauri = vi.hoisted(() => ({ projectHtmlPreviewUrl: vi.fn() }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  projectHtmlPreviewUrl: tauri.projectHtmlPreviewUrl,
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

import { HtmlFilePreview } from "./HtmlFilePreview";

const PATH = "site/attention-demo.html";
const URL = "http://127.0.0.1:4100/t0k3n/site/attention-demo.html";

function edit(content: string, dirty: boolean) {
  act(() => useFilesStore.setState({ files: { [PATH]: { content, dirty } } } as never));
}

afterEach(() => {
  vi.clearAllMocks();
  useFilesStore.setState({ files: {} } as never);
});

describe("HtmlFilePreview", () => {
  it("shows the page from the project's preview address and reloads it after each save", async () => {
    tauri.projectHtmlPreviewUrl.mockResolvedValue(URL);
    edit("<h1>One</h1>", false);
    render(<HtmlFilePreview projectId="p1" path={PATH} />);
    expect(screen.getByText(/Loading/)).toBeInTheDocument();

    const frame = await screen.findByTitle("attention-demo.html");
    expect(tauri.projectHtmlPreviewUrl).toHaveBeenCalledWith("p1", PATH);
    expect(frame).toHaveAttribute("src", `${URL}?v=1`);
    expect(frame.getAttribute("sandbox")).toContain("allow-scripts");

    edit("<h1>Two</h1>", true);
    expect(frame).toHaveAttribute("src", `${URL}?v=1`);
    edit("<h1>Two</h1>", false);
    expect(frame).toHaveAttribute("src", `${URL}?v=2`);
  });

  it("says why when the page cannot be shown", async () => {
    tauri.projectHtmlPreviewUrl.mockRejectedValue("no such page");
    render(<HtmlFilePreview projectId="p1" path={PATH} />);
    expect(
      await screen.findByText(enEditor.shell.htmlPreviewFailed.replace("{{detail}}", "no such page")),
    ).toBeInTheDocument();
  });
});
