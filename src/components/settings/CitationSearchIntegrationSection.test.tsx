// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectorKeySaved: vi.fn(),
  setConnectorKey: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  connectorKeySaved: mocks.connectorKeySaved,
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
  mocks.connectorKeySaved.mockResolvedValue(false);
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

  it("marks OpenAlex connected when only its API key is stored", async () => {
    mocks.connectorKeySaved.mockImplementation(async (id: string) => id === "openalex-api-key");
    render(<CitationSearchIntegrationSection />);

    await waitFor(() =>
      expect(screen.getAllByText(citations.connected)).toHaveLength(1),
    );
    expect(
      screen.getByRole("button", { name: citations.actions.removeApiKey }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("openalex-email-input")).toBeInTheDocument();
  });

  it("points the OpenAlex link at the authentication help page", async () => {
    render(<CitationSearchIntegrationSection />);

    expect(
      await screen.findByRole("link", { name: citations.openAlex.docsLink }),
    ).toHaveAttribute("href", "https://help.openalex.org/api/authentication/");
  });

  it("marks every source connected and offers removal when keys are stored", async () => {
    mocks.connectorKeySaved.mockResolvedValue(true);
    render(<CitationSearchIntegrationSection />);

    await waitFor(() =>
      expect(screen.getAllByText(citations.connected)).toHaveLength(5),
    );
    expect(
      screen.getAllByRole("button", { name: citations.actions.removeKey }),
    ).toHaveLength(4);
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
    mocks.connectorKeySaved.mockResolvedValue(true);
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
    mocks.connectorKeySaved.mockRejectedValue(new Error("no keychain"));
    render(<CitationSearchIntegrationSection />);

    expect(
      await screen.findByLabelText(citations.semanticScholar.keyLabel),
    ).toBeInTheDocument();
    expect(screen.queryByText(citations.connected)).not.toBeInTheDocument();
  });

  it("saves and removes the Brave Search key", async () => {
    const user = userEvent.setup();
    render(<CitationSearchIntegrationSection />);

    await user.type(await screen.findByTestId("brave-search-api-key-input"), "  bk  ");
    await user.click(screen.getByTestId("brave-search-api-key-save"));
    await waitFor(() =>
      expect(mocks.setConnectorKey).toHaveBeenCalledWith("brave-search", "bk"),
    );
    await expectAnnounced(citations.braveSearch.keySaved);
    expect(screen.queryByTestId("brave-search-api-key-input")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: citations.actions.removeKey }));
    await waitFor(() =>
      expect(mocks.setConnectorKey).toHaveBeenCalledWith("brave-search", ""),
    );
    await expectAnnounced(citations.braveSearch.keyRemoved);
  });

  it("saves the Tavily key under its connector id", async () => {
    const user = userEvent.setup();
    render(<CitationSearchIntegrationSection />);

    await user.type(await screen.findByTestId("tavily-api-key-input"), "tk");
    await user.click(screen.getByTestId("tavily-api-key-save"));
    await waitFor(() => expect(mocks.setConnectorKey).toHaveBeenCalledWith("tavily", "tk"));
    await expectAnnounced(citations.tavily.keySaved);
  });

  it("explains which web search key the assistant uses first", async () => {
    render(<CitationSearchIntegrationSection />);

    expect(
      await screen.findByText(/Brave first, then Tavily, then Serper/),
    ).toBeInTheDocument();
    expect(screen.getAllByText(citations.braveSearch.hint)).toHaveLength(2);
    expect(
      screen.getByRole("link", { name: citations.braveSearch.docsLink }),
    ).toHaveAttribute("href", "https://brave.com/search/api/");
    expect(
      screen.getByRole("link", { name: citations.tavily.docsLink }),
    ).toHaveAttribute("href", "https://docs.tavily.com/");
  });
});
