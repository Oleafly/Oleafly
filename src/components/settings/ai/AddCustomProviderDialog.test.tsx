// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  AddCustomProviderDialog,
  KEY_REQUIRED_FOR_URL_CHANGE,
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

    expect(screen.getByRole("heading", { name: "Add custom provider" })).toBeInTheDocument();
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

    expect(screen.getByRole("heading", { name: "Edit custom provider" })).toBeInTheDocument();
    expect(screen.getByTestId("custom-provider-id")).toHaveValue("acme");
    expect(screen.getByTestId("custom-provider-id")).toBeDisabled();
    expect(screen.getByTestId("custom-provider-name")).toHaveValue("Acme");
    expect(screen.getByTestId("custom-provider-baseurl")).toHaveValue("https://api.acme.test/v1");
    expect(screen.getByTestId("custom-provider-key")).toHaveValue("");
    expect(screen.getByText("API key (leave blank to keep the saved key)")).toBeInTheDocument();
    expect(screen.getByTestId("custom-provider-submit")).toHaveTextContent("Save");
  });

  it("requires the key again when the base URL changes and a key is stored", async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    render(
      <AddCustomProviderDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} editing={ACME} />,
    );

    fill("custom-provider-baseurl", "https://api.acme.test/v2");
    fireEvent.click(screen.getByTestId("custom-provider-submit"));

    expect(screen.getByTestId("custom-provider-key-error")).toHaveTextContent(
      KEY_REQUIRED_FOR_URL_CHANGE,
    );
    expect(onSubmit).not.toHaveBeenCalled();

    fill("custom-provider-key", "sk-new");
    expect(screen.queryByTestId("custom-provider-key-error")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("custom-provider-submit"));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        id: "acme",
        name: "Acme",
        baseURL: "https://api.acme.test/v2",
        apiKey: "sk-new",
      }),
    );
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
    expect(normalizeBaseURL("http://localhost:1234")).toBe("http://localhost:1234");
  });
});
