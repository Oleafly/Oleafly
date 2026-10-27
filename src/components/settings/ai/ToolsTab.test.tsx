// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };

const mocks = vi.hoisted(() => ({
  mathpixKeyStatus: vi.fn(),
  mathpixSaveKeys: vi.fn(),
  mathpixClearKeys: vi.fn(),
  connectorKeySaved: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/lib/mathpix", () => ({
  mathpixKeyStatus: mocks.mathpixKeyStatus,
  mathpixSaveKeys: mocks.mathpixSaveKeys,
  mathpixClearKeys: mocks.mathpixClearKeys,
}));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  connectorKeySaved: mocks.connectorKeySaved,
}));
vi.mock("@/lib/toast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/toast")>()),
  toast: { success: mocks.toastSuccess, error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/components/tools/ToolsModelBar", () => ({
  ToolsModelPicker: () => <div data-testid="tools-model-picker" />,
  ToolsModelNotice: ({ scope }: { scope: string }) => <span data-testid="tools-model-notice" data-scope={scope} />,
}));

import { ToolsTab } from "./ToolsTab";

const tools = enSettings.ai.tools;

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <ToolsTab />
    </QueryClientProvider>,
  );
  return { client, invalidate };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mathpixKeyStatus.mockResolvedValue({ configured: false, appId: null });
  mocks.mathpixSaveKeys.mockResolvedValue({ configured: true, appId: "APP" });
  mocks.mathpixClearKeys.mockResolvedValue(undefined);
});

describe("Settings, AI, Tools", () => {
  it("shows the Tools model picker, its notice and the local OCR hint", async () => {
    renderTab();
    expect(screen.getByText(tools.modelTitle)).toBeInTheDocument();
    expect(screen.getByText(tools.modelDescription)).toBeInTheDocument();
    expect(screen.getByTestId("tools-model-picker")).toBeInTheDocument();
    expect(screen.getByTestId("tools-model-notice")).toHaveAttribute("data-scope", "images");
    expect(screen.getByText(tools.ocrHint)).toBeInTheDocument();
    expect(screen.getByText("ollama pull glm-ocr")).toBeInTheDocument();
    expect(screen.getByText(tools.mathpix.privacy)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: new RegExp(tools.mathpix.docs) })).toHaveAttribute(
      "href",
      "https://console.mathpix.com",
    );
    await waitFor(() => expect(mocks.mathpixKeyStatus).toHaveBeenCalled());
  });

  it("saves Mathpix keys through the backend and never reads the key back", async () => {
    renderTab();
    const appId = await screen.findByTestId("mathpix-app-id");
    const appKey = screen.getByTestId("mathpix-app-key");
    expect(appKey).toHaveAttribute("type", "password");
    expect(screen.getByTestId("mathpix-save")).toBeDisabled();
    fireEvent.change(appId, { target: { value: " APP " } });
    fireEvent.change(appKey, { target: { value: " KEY " } });
    mocks.mathpixKeyStatus.mockResolvedValue({ configured: true, appId: "APP" });
    fireEvent.click(screen.getByTestId("mathpix-save"));

    await waitFor(() => expect(mocks.mathpixSaveKeys).toHaveBeenCalledWith("APP", "KEY"));
    expect(await screen.findByTestId("mathpix-connected")).toHaveTextContent(
      tools.mathpix.connected.replace("{{appId}}", "APP"),
    );
    expect(screen.queryByTestId("mathpix-app-key")).not.toBeInTheDocument();
    expect(mocks.toastSuccess).toHaveBeenCalledWith(tools.mathpix.saved);
    expect(mocks.connectorKeySaved).not.toHaveBeenCalled();
    expect(document.body.innerHTML).not.toContain("KEY ");
  });

  it("shows the backend's reason when Mathpix rejects the keys", async () => {
    mocks.mathpixSaveKeys.mockRejectedValue('@oleafly/error:{"code":"mathpix.key_rejected","params":{}}');
    renderTab();
    fireEvent.change(await screen.findByTestId("mathpix-app-id"), { target: { value: "APP" } });
    fireEvent.change(screen.getByTestId("mathpix-app-key"), { target: { value: "WRONG" } });
    fireEvent.click(screen.getByTestId("mathpix-save"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Mathpix didn't accept these keys. Check the app ID and key in the Mathpix console.",
    );
    expect(screen.queryByTestId("mathpix-connected")).not.toBeInTheDocument();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("removes the keys", async () => {
    mocks.mathpixKeyStatus.mockResolvedValue({ configured: true, appId: "APP" });
    const { invalidate } = renderTab();
    expect(await screen.findByTestId("mathpix-connected")).toHaveTextContent("APP");
    mocks.mathpixKeyStatus.mockResolvedValue({ configured: false, appId: null });
    fireEvent.click(screen.getByTestId("mathpix-remove"));
    await waitFor(() => expect(mocks.mathpixClearKeys).toHaveBeenCalledOnce());
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["mathpix-key-status"] }));
    expect(await screen.findByTestId("mathpix-app-id")).toBeInTheDocument();
    expect(mocks.toastSuccess).toHaveBeenCalledWith(tools.mathpix.removed);
  });
});
