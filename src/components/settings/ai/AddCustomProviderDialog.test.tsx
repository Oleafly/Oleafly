// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/locales/en/common.json" with { type: "json" };
import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import {
  AddCustomProviderDialog,
  normalizeBaseURL,
  type CustomProviderEditTarget,
} from "./AddCustomProviderDialog";

const ACME: CustomProviderEditTarget = {
  id: "acme",
  name: "Acme",
  baseURL: "https://api.acme.test/v1",
  hasStoredKey: true,
};

function fill(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

describe("AddCustomProviderDialog", () => {
  it("adds a provider once the form validates", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    const onOpenChange = vi.fn();
    render(<AddCustomProviderDialog open onOpenChange={onOpenChange} onSubmit={onSubmit} />);

    expect(
      screen.getByRole("heading", { name: enSettings.ai.customProvider.addTitle }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("custom-provider-submit"));
    expect(screen.getByTestId("custom-provider-id-error")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    fill("custom-provider-id", "acme");
    fill("custom-provider-name", " Acme ");
    fill("custom-provider-baseurl", "https://api.acme.test/v1");
    fireEvent.click(screen.getByTestId("custom-provider-submit"));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        id: "acme",
        name: "Acme",
        baseURL: "https://api.acme.test/v1",
        apiKey: "",
      }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("prefills an existing provider and locks its id in edit mode", () => {
    render(
      <AddCustomProviderDialog open onOpenChange={vi.fn()} onSubmit={vi.fn()} editing={ACME} />,
    );

    expect(
      screen.getByRole("heading", { name: enSettings.ai.customProvider.editTitle }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("custom-provider-id")).toHaveValue("acme");
    expect(screen.getByTestId("custom-provider-id")).toBeDisabled();
    expect(screen.getByTestId("custom-provider-name")).toHaveValue("Acme");
    expect(screen.getByTestId("custom-provider-baseurl")).toHaveValue("https://api.acme.test/v1");
    expect(screen.getByTestId("custom-provider-key")).toHaveValue("");
    expect(
      screen.getByText(enSettings.ai.customProvider.keyLabelKeepSaved),
    ).toBeInTheDocument();
    expect(screen.getByTestId("custom-provider-submit")).toHaveTextContent(
      enCommon.actions.save,
    );
  });

  it("moves a provider that has a key with or without typing it again", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    render(
      <AddCustomProviderDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} editing={ACME} />,
    );

    fill("custom-provider-baseurl", "http://localhost:13305/v1");
    expect(screen.getByLabelText(enSettings.ai.customProvider.keyLabel)).toBeInTheDocument();
    expect(screen.getByTestId("custom-provider-baseurl-note")).toHaveTextContent(
      enSettings.ai.customProvider.baseUrlNote,
    );
    fireEvent.click(screen.getByTestId("custom-provider-submit"));

    expect(screen.queryByTestId("custom-provider-key-error")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        id: "acme",
        name: "Acme",
        baseURL: "http://localhost:13305/v1",
        apiKey: "",
      }),
    );
  });

  it("counts a trimmed endpoint path as a new address", () => {
    render(
      <AddCustomProviderDialog
        open
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
        editing={{ ...ACME, baseURL: "https://api.acme.test/v1/chat/completions" }}
      />,
    );
    expect(screen.getByTestId("custom-provider-baseurl-note")).toBeInTheDocument();
  });

  it("offers to save anyway when no models were listed, until a field changes", async () => {
    const onSubmit = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, canForce: true, message: "Could not reach it." })
      .mockResolvedValueOnce({ ok: false, canForce: true, message: "Could not reach it." })
      .mockResolvedValue({ ok: true });
    const onOpenChange = vi.fn();
    render(<AddCustomProviderDialog open onOpenChange={onOpenChange} onSubmit={onSubmit} />);

    fill("custom-provider-id", "lemonade");
    fill("custom-provider-name", "Lemonade");
    fill("custom-provider-baseurl", "http://localhost:13305");
    fireEvent.click(screen.getByTestId("custom-provider-submit"));

    expect(await screen.findByTestId("custom-provider-error")).toHaveTextContent("Could not reach it.");
    expect(screen.getByTestId("custom-provider-submit")).toHaveTextContent(
      enSettings.ai.customProvider.submitAddAnyway,
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    fill("custom-provider-baseurl", "http://localhost:13305/v1");
    expect(screen.getByTestId("custom-provider-submit")).toHaveTextContent(
      enSettings.ai.customProvider.submitAdd,
    );
    fireEvent.click(screen.getByTestId("custom-provider-submit"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[1]).toHaveLength(1);

    fireEvent.click(await screen.findByText(enSettings.ai.customProvider.submitAddAnyway));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(3));
    expect(onSubmit.mock.calls[2][1]).toEqual({ force: true });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("refuses a base URL with credentials or a query string", () => {
    render(<AddCustomProviderDialog open onOpenChange={vi.fn()} onSubmit={vi.fn()} />);
    fill("custom-provider-id", "acme");
    fill("custom-provider-name", "Acme");

    fill("custom-provider-baseurl", "https://user:secret@api.acme.test/v1");
    fireEvent.click(screen.getByTestId("custom-provider-submit"));
    expect(screen.getByTestId("custom-provider-baseurl-error")).toHaveTextContent(
      enSettings.ai.customProvider.errors.baseUrlCredentials,
    );

    fill("custom-provider-baseurl", "https://api.acme.test/v1?api-version=2");
    fireEvent.click(screen.getByTestId("custom-provider-submit"));
    expect(screen.getByTestId("custom-provider-baseurl-error")).toHaveTextContent(
      enSettings.ai.customProvider.errors.baseUrlQuery,
    );
  });

  it("refuses an id longer than the backend accepts", () => {
    render(<AddCustomProviderDialog open onOpenChange={vi.fn()} onSubmit={vi.fn()} />);
    fill("custom-provider-id", "a".repeat(65));
    fireEvent.click(screen.getByTestId("custom-provider-submit"));
    expect(screen.getByTestId("custom-provider-id-error")).toHaveTextContent(
      enSettings.ai.customProvider.errors.idTooLong,
    );
  });

  it("shows a note that the saved key is not sent, only while the URL differs and a key is stored", () => {
    const { rerender } = render(
      <AddCustomProviderDialog open onOpenChange={vi.fn()} onSubmit={vi.fn()} editing={ACME} />,
    );

    expect(screen.queryByTestId("custom-provider-baseurl-note")).not.toBeInTheDocument();

    fill("custom-provider-baseurl", "https://api.acme.test/v2");
    expect(screen.getByTestId("custom-provider-baseurl-note")).toHaveTextContent(
      enSettings.ai.customProvider.baseUrlNote,
    );

    fill("custom-provider-baseurl", "https://api.acme.test/v1");
    expect(screen.queryByTestId("custom-provider-baseurl-note")).not.toBeInTheDocument();

    rerender(
      <AddCustomProviderDialog
        open
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
        editing={{ ...ACME, hasStoredKey: false }}
      />,
    );
    fill("custom-provider-baseurl", "https://api.acme.test/v2");
    expect(screen.queryByTestId("custom-provider-baseurl-note")).not.toBeInTheDocument();
  });

  it("saves a rename without the key when the base URL is unchanged", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    render(
      <AddCustomProviderDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} editing={ACME} />,
    );

    fill("custom-provider-name", "Acme Labs");
    fill("custom-provider-baseurl", "https://api.acme.test/v1/");
    fireEvent.click(screen.getByTestId("custom-provider-submit"));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        id: "acme",
        name: "Acme Labs",
        baseURL: "https://api.acme.test/v1/",
        apiKey: "",
      }),
    );
  });

  it("does not ask for a key when none is stored", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    render(
      <AddCustomProviderDialog
        open
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        editing={{ ...ACME, hasStoredKey: false }}
      />,
    );

    fill("custom-provider-baseurl", "http://localhost:1234/v1");
    fireEvent.click(screen.getByTestId("custom-provider-submit"));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        id: "acme",
        name: "Acme",
        baseURL: "http://localhost:1234/v1",
        apiKey: "",
      }),
    );
  });

  it("shows the message the save handler returns and stays open", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: false, message: "That endpoint did not answer." });
    const onOpenChange = vi.fn();
    render(
      <AddCustomProviderDialog open onOpenChange={onOpenChange} onSubmit={onSubmit} editing={ACME} />,
    );

    fill("custom-provider-name", "Acme Labs");
    fireEvent.click(screen.getByTestId("custom-provider-submit"));

    expect(await screen.findByText("That endpoint did not answer.")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("normalizes trailing slashes in base URLs", () => {
    expect(normalizeBaseURL(" https://api.acme.test/v1// ")).toBe("https://api.acme.test/v1");
    expect(normalizeBaseURL("http://localhost:1234/v1/chat/completions")).toBe(
      "http://localhost:1234/v1",
    );
    expect(normalizeBaseURL("http://localhost:1234")).toBe("http://localhost:1234");
    expect(normalizeBaseURL("")).toBe("");
    expect(normalizeBaseURL("   ")).toBe("");
    expect(normalizeBaseURL("/")).toBe("");
    expect(normalizeBaseURL("////")).toBe("");
    expect(normalizeBaseURL("https://api.acme.test/")).toBe("https://api.acme.test");
    expect(normalizeBaseURL(`https://api.acme.test${"/".repeat(5000)}`)).toBe(
      "https://api.acme.test",
    );
  });
});

describe("AddCustomProviderDialog presets", () => {
  it("fills in a known endpoint in one click and leaves the key to the user", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    render(<AddCustomProviderDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} />);

    expect(screen.getByRole("group", { name: enSettings.ai.customProvider.presetsLabel })).toBeInTheDocument();
    const qwen = screen.getByTestId("custom-provider-preset-qwen");
    expect(qwen).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(qwen);

    expect(screen.getByTestId("custom-provider-id")).toHaveValue("qwen");
    expect(screen.getByTestId("custom-provider-name")).toHaveValue("Qwen (DashScope)");
    expect(screen.getByTestId("custom-provider-baseurl")).toHaveValue(
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    );
    expect(qwen).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("custom-provider-key")).toHaveFocus();

    fill("custom-provider-key", "sk-qwen");
    fireEvent.click(screen.getByTestId("custom-provider-submit"));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        id: "qwen",
        name: "Qwen (DashScope)",
        baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "sk-qwen",
      }),
    );
  });

  it("hides presets already added and every preset while editing", () => {
    const { rerender } = render(
      <AddCustomProviderDialog open onOpenChange={vi.fn()} onSubmit={vi.fn()} takenIds={["kimi"]} />,
    );
    expect(screen.queryByTestId("custom-provider-preset-kimi")).toBeNull();
    expect(screen.getByTestId("custom-provider-preset-zhipu")).toBeInTheDocument();

    rerender(<AddCustomProviderDialog open onOpenChange={vi.fn()} onSubmit={vi.fn()} editing={ACME} />);
    expect(screen.queryByRole("group", { name: enSettings.ai.customProvider.presetsLabel })).toBeNull();
  });

  it("checks a preset picked after a failed address instead of adding it anyway", async () => {
    const onSubmit = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, canForce: true, message: "Could not reach it." })
      .mockResolvedValue({ ok: true });
    render(<AddCustomProviderDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByTestId("custom-provider-preset-qwen"));
    fill("custom-provider-key", "sk-qwen");
    fireEvent.click(screen.getByTestId("custom-provider-submit"));
    expect(await screen.findByTestId("custom-provider-error")).toHaveTextContent("Could not reach it.");
    expect(screen.getByTestId("custom-provider-submit")).toHaveTextContent(
      enSettings.ai.customProvider.submitAddAnyway,
    );

    fireEvent.click(screen.getByTestId("custom-provider-preset-kimi"));
    expect(screen.getByTestId("custom-provider-submit")).toHaveTextContent(
      enSettings.ai.customProvider.submitAdd,
    );
    expect(screen.queryByTestId("custom-provider-error")).toBeNull();
    fireEvent.click(screen.getByTestId("custom-provider-submit"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[1]).toEqual([
      { id: "kimi", name: "Kimi (Moonshot)", baseURL: "https://api.moonshot.cn/v1", apiKey: "sk-qwen" },
    ]);
  });
});

describe("AddCustomProviderDialog validation", () => {
  const errors = enSettings.ai.customProvider.errors;

  it.each([
    ["Acme Corp", "https://api.acme.test/v1", "custom-provider-id-error", errors.idFormat],
    ["acme", "ftp://files.acme.test", "custom-provider-baseurl-error", errors.baseUrlProtocol],
    ["acme", "not a url", "custom-provider-baseurl-error", errors.baseUrlInvalid],
  ])("rejects id %s with base URL %s", (id, baseURL, errorId, message) => {
    const onSubmit = vi.fn();
    render(<AddCustomProviderDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} />);

    fill("custom-provider-id", id);
    fill("custom-provider-name", "Acme");
    fill("custom-provider-baseurl", baseURL);
    fireEvent.click(screen.getByTestId("custom-provider-submit"));

    expect(screen.getByTestId(errorId)).toHaveTextContent(message);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits with Enter in a field and sends a typed key", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    render(<AddCustomProviderDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} />);

    fill("custom-provider-id", "acme");
    fill("custom-provider-name", "Acme");
    fill("custom-provider-baseurl", "http://localhost:1234/v1");
    fill("custom-provider-key", "sk-local");
    fireEvent.keyDown(screen.getByTestId("custom-provider-baseurl"), { key: "Enter" });

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        id: "acme",
        name: "Acme",
        baseURL: "http://localhost:1234/v1",
        apiKey: "sk-local",
      }),
    );
  });

  it("falls back to a generic message when the save gives no reason", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: false });
    const { unmount } = render(<AddCustomProviderDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} />);
    fill("custom-provider-id", "acme");
    fill("custom-provider-name", "Acme");
    fill("custom-provider-baseurl", "https://api.acme.test/v1");
    fireEvent.click(screen.getByTestId("custom-provider-submit"));
    expect(await screen.findByText(errors.addFailed)).toBeInTheDocument();
    unmount();

    render(<AddCustomProviderDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} editing={ACME} />);
    fireEvent.click(screen.getByTestId("custom-provider-submit"));
    expect(await screen.findByText(errors.saveFailed)).toBeInTheDocument();
  });

  it("clears the form when it closes", () => {
    const onOpenChange = vi.fn();
    render(<AddCustomProviderDialog open onOpenChange={onOpenChange} onSubmit={vi.fn()} />);
    fill("custom-provider-id", "draft");

    fireEvent.keyDown(screen.getByTestId("custom-provider-id"), { key: "Escape" });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
