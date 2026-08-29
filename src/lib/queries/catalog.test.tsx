// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listFontComponents,
  listTemplatePacks,
  listTemplates,
  refreshPackCatalog,
} from "@/lib/tauri";
import { createAppQueryClient } from "@/lib/query";
import { useFontComponents, useTemplatePacks, useTemplates } from "./catalog";

vi.mock("@/lib/tauri", () => ({
  listTemplates: vi.fn(),
  listFontComponents: vi.fn(),
  listTemplatePacks: vi.fn(),
  refreshPackCatalog: vi.fn(),
}));

const mockTemplates = vi.mocked(listTemplates);
const mockFonts = vi.mocked(listFontComponents);
const mockPacks = vi.mocked(listTemplatePacks);
const mockCatalog = vi.mocked(refreshPackCatalog);

function Probe({ templatesEnabled = true }: { templatesEnabled?: boolean }) {
  const templates = useTemplates(templatesEnabled);
  const fonts = useFontComponents();
  const packs = useTemplatePacks();
  return (
    <p>{`t:${templates.data?.length ?? "-"} f:${fonts.data?.length ?? "-"} p:${packs.data?.length ?? "-"}`}</p>
  );
}

describe("catalog queries", () => {
  beforeEach(() => {
    mockTemplates.mockReset().mockResolvedValue([]);
    mockFonts.mockReset().mockResolvedValue([]);
    mockPacks.mockReset().mockResolvedValue([]);
    mockCatalog.mockReset().mockResolvedValue(undefined);
  });

  it("loads templates, fonts, and packs", async () => {
    mockTemplates.mockResolvedValue([{ id: "a" }, { id: "b" }] as never);
    mockFonts.mockResolvedValue([{ id: "f" }] as never);
    mockPacks.mockResolvedValue([{ id: "p" }] as never);

    render(
      <QueryClientProvider client={createAppQueryClient()}>
        <Probe />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("t:2 f:1 p:1")).toBeInTheDocument();
  });

  it("still lists packs when the CDN catalog refresh fails", async () => {
    mockCatalog.mockRejectedValue(new Error("offline"));
    mockPacks.mockResolvedValue([{ id: "bundled" }] as never);

    render(
      <QueryClientProvider client={createAppQueryClient()}>
        <Probe templatesEnabled={false} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("t:- f:0 p:1")).toBeInTheDocument();
    expect(mockTemplates).not.toHaveBeenCalled();
  });
});
