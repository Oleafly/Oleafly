// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConnectorKey: vi.fn(),
  setConnectorKey: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  getConnectorKey: mocks.getConnectorKey,
  setConnectorKey: mocks.setConnectorKey,
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { CitationSearchIntegrationSection } from "./CitationSearchIntegrationSection";

const citations = enSettings.citations;

async function expectAnnounced(message: string) {
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(message));
  expect(mocks.success).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getConnectorKey.mockResolvedValue("");
  mocks.setConnectorKey.mockResolvedValue(undefined);
});

describe("CitationSearchIntegrationSection", () => {
  it("offers a credential field for each keyed source when nothing is stored", async () => {
    render(<CitationSearchIntegrationSection />);

    expect(await screen.findByText(citations.title)).toBeInTheDocument();
    expect(screen.getByText(citations.description)).toBeInTheDocument();
    expect(
      screen.getByLabelText(citations.semanticScholar.keyLabel),
    ).toBeInTheDocument();
    expect(screen.getByTestId("openalex-email-input")).toBeInTheDocument();
    expect(screen.getByTestId("serper-api-key-input")).toBeInTheDocument();
    expect(screen.queryByText(citations.connected)).not.toBeInTheDocument();
    expect(screen.getByText(citations.keyFree.title)).toBeInTheDocument();
    expect(screen.getByText(citations.keyFree.description)).toBeInTheDocument();
    expect(screen.getByText(citations.semanticScholar.hint)).toBeInTheDocument();
    expect(screen.getByText(citations.openAlex.hint)).toBeInTheDocument();
    expect(screen.getByText(citations.serper.hint)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: citations.semanticScholar.docsLink }),
    ).toHaveAttribute("href");
    expect(
      screen.getByRole("link", { name: citations.openAlex.docsLink }),
    ).toHaveAttribute("href");
    expect(
      screen.getByRole("link", { name: citations.serper.docsLink }),
    ).toHaveAttribute("href");
  });

  it("marks every source connected and offers removal when keys are stored", async () => {
    mocks.getConnectorKey.mockResolvedValue("stored");
    render(<CitationSearchIntegrationSection />);

    await waitFor(() =>
      expect(screen.getAllByText(citations.connected)).toHaveLength(3),
    );
    expect(
      screen.getAllByRole("button", { name: citations.actions.removeKey }),
    ).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: citations.actions.removeEmail }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(citations.semanticScholar.keyLabel),
    ).not.toBeInTheDocument();
  });

  it("saves and then removes the Semantic Scholar key", async () => {
    const user = userEvent.setup();
    render(<CitationSearchIntegrationSection />);

    const field = await screen.findByLabelText(
      citations.semanticScholar.keyLabel,
    );
    const saveKey = screen.getAllByRole("button", {
      name: citations.actions.saveKey,
    })[0];
    expect(saveKey).toBeDisabled();

    await user.type(field, "  s2-token  ");
    await user.click(saveKey);

    await waitFor(() =>
      expect(mocks.setConnectorKey).toHaveBeenCalledWith(
        "semantic-scholar",
        "s2-token",
      ),
    );
    await expectAnnounced(citations.semanticScholar.keySaved);

    await user.click(
      screen.getAllByRole("button", { name: citations.actions.removeKey })[0],
    );
    await waitFor(() =>
      expect(mocks.setConnectorKey).toHaveBeenCalledWith(
        "semantic-scholar",
        "",
      ),
    );
    await expectAnnounced(citations.semanticScholar.keyRemoved);
  });

  it("saves and then removes the OpenAlex contact email", async () => {
    const user = userEvent.setup();
    render(<CitationSearchIntegrationSection />);

    await user.type(
      await screen.findByTestId("openalex-email-input"),
      "me@example.org",
    );
    await user.click(screen.getByTestId("openalex-email-save"));

    await waitFor(() =>
      expect(mocks.setConnectorKey).toHaveBeenCalledWith(
        "openalex-email",
        "me@example.org",
      ),
    );
    await expectAnnounced(citations.openAlex.emailSaved);

    await user.click(
      screen.getByRole("button", { name: citations.actions.removeEmail }),
    );
    await waitFor(() =>
      expect(mocks.setConnectorKey).toHaveBeenCalledWith("openalex-email", ""),
    );
    await expectAnnounced(citations.openAlex.emailRemoved);
  });

  it("saves and then removes the Serper key", async () => {
    const user = userEvent.setup();
    render(<CitationSearchIntegrationSection />);

    await user.type(
      await screen.findByTestId("serper-api-key-input"),
      "serper-token",
    );
    await user.click(screen.getByTestId("serper-api-key-save"));

    await waitFor(() =>
      expect(mocks.setConnectorKey).toHaveBeenCalledWith(
        "serper",
        "serper-token",
      ),
    );
    await expectAnnounced(citations.serper.keySaved);

    await user.click(
      screen.getByRole("button", { name: citations.actions.removeKey }),
    );
    await waitFor(() =>
      expect(mocks.setConnectorKey).toHaveBeenCalledWith("serper", ""),
    );
    await expectAnnounced(citations.serper.keyRemoved);
  });

  it("reports a failure for every save and every removal", async () => {
    const user = userEvent.setup();
    mocks.setConnectorKey.mockRejectedValue(new Error("keychain locked"));
    render(<CitationSearchIntegrationSection />);

    await user.type(
      await screen.findByLabelText(citations.semanticScholar.keyLabel),
      "a",
    );
    await user.click(
      screen.getAllByRole("button", { name: citations.actions.saveKey })[0],
    );
    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith(
        citations.semanticScholar.keySaveFailed,
      ),
    );
    expect(mocks.logError).toHaveBeenCalledWith(
      "citation search semantic-scholar",
      expect.any(Error),
    );
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    await user.type(screen.getByTestId("openalex-email-input"), "b@c.d");
    await user.click(screen.getByTestId("openalex-email-save"));
    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith(
        citations.openAlex.emailSaveFailed,
      ),
    );

    await user.type(screen.getByTestId("serper-api-key-input"), "c");
    await user.click(screen.getByTestId("serper-api-key-save"));
    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith(citations.serper.keySaveFailed),
    );
  });

  it("reports a failure when removing a stored credential", async () => {
    const user = userEvent.setup();
    mocks.getConnectorKey.mockResolvedValue("stored");
    mocks.setConnectorKey.mockRejectedValue(new Error("keychain locked"));
    render(<CitationSearchIntegrationSection />);

    const removeKeys = await screen.findAllByRole("button", {
      name: citations.actions.removeKey,
    });
    await user.click(removeKeys[0]);
    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith(
        citations.semanticScholar.keyRemoveFailed,
      ),
    );

    await user.click(
      screen.getByRole("button", { name: citations.actions.removeEmail }),
    );
    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith(
        citations.openAlex.emailRemoveFailed,
      ),
    );

    await user.click(
      screen.getAllByRole("button", { name: citations.actions.removeKey })[1],
    );
    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith(citations.serper.keyRemoveFailed),
    );
    expect(mocks.logError).toHaveBeenCalledTimes(3);
  });

  it("saves and then removes the OpenAlex API key", async () => {
    const user = userEvent.setup();
    render(<CitationSearchIntegrationSection />);

    await user.type(
      await screen.findByTestId("openalex-api-key-input"),
      "oa-key",
    );
    await user.click(screen.getByTestId("openalex-api-key-save"));
    await waitFor(() =>
      expect(mocks.setConnectorKey).toHaveBeenCalledWith(
        "openalex-api-key",
        "oa-key",
      ),
    );
    await expectAnnounced(citations.openAlex.keySaved);

    await user.click(
      screen.getByRole("button", { name: citations.actions.removeApiKey }),
    );
    await waitFor(() =>
      expect(mocks.setConnectorKey).toHaveBeenCalledWith("openalex-api-key", ""),
    );
    await expectAnnounced(citations.openAlex.keyRemoved);
    expect(screen.getByTestId("openalex-api-key-input")).toBeInTheDocument();
  });

  it("treats a failed credential read as not connected", async () => {
    mocks.getConnectorKey.mockRejectedValue(new Error("no keychain"));
    render(<CitationSearchIntegrationSection />);

    expect(
      await screen.findByLabelText(citations.semanticScholar.keyLabel),
    ).toBeInTheDocument();
    expect(screen.queryByText(citations.connected)).not.toBeInTheDocument();
  });
});
