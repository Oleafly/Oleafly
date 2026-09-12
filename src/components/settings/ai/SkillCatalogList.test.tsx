// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillAssetProgress, SkillCatalog, SkillCatalogEntry } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({
  listen: vi.fn(),
  unlisten: vi.fn(),
  skillsCatalog: vi.fn(),
  skillsInstall: vi.fn(),
  skillsUninstall: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  skillsCatalog: mocks.skillsCatalog,
  skillsInstall: mocks.skillsInstall,
  skillsUninstall: mocks.skillsUninstall,
}));

import enSettings from "@/i18n/locales/en/settings.json" with { type: "json" };
import { formatDateTime } from "@/lib/intl";
import { createAppQueryClient } from "@/lib/query";
import { SkillCatalogList, catalogSourceLine } from "./SkillCatalogList";

const skills = enSettings.ai.skills;
const catalogCopy = skills.catalog;
const WHEN = "2026-08-20T12:00:00.000Z";
const WHEN_TEXT = formatDateTime(new Date(WHEN));

const entry = (over: Partial<SkillCatalogEntry> = {}): SkillCatalogEntry => ({
  id: "oleafly-latex",
  name: "Oleafly LaTeX",
  description: "LaTeX authoring help",
  domain: "writing",
  license: "MIT",
  version: "1.0.0",
  bytes: 2_400,
  files: 4,
  bundled: false,
  installed: false,
  updateAvailable: false,
  ...over,
});

const catalog = (over: Partial<SkillCatalog> = {}): SkillCatalog => ({
  source: "fetched",
  generatedAt: WHEN,
  fetchedAt: WHEN,
  skills: [entry()],
  ...over,
});

let emit: ((event: { payload: SkillAssetProgress }) => void) | null = null;

function renderList() {
  render(
    <QueryClientProvider client={createAppQueryClient()}>
      <SkillCatalogList />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  emit = null;
  mocks.listen.mockImplementation(
    async (_name: string, handler: (event: { payload: SkillAssetProgress }) => void) => {
      emit = handler;
      return mocks.unlisten;
    },
  );
  mocks.skillsCatalog.mockResolvedValue(catalog());
  mocks.skillsInstall.mockResolvedValue({ id: "oleafly-latex" });
  mocks.skillsUninstall.mockResolvedValue(undefined);
});

describe("catalogSourceLine", () => {
  it("names every catalog provenance", () => {
    expect(catalogSourceLine(catalog({ source: "bundled" }))).toBe(
      catalogCopy.source.bundled,
    );
    expect(catalogSourceLine(catalog({ source: "bundled", error: "offline" }))).toBe(
      catalogCopy.source.bundledOffline,
    );
    expect(catalogSourceLine(catalog({ source: "cached" }))).toBe(
      catalogCopy.source.cached.replace("{{when}}", WHEN_TEXT),
    );
    expect(
      catalogSourceLine(catalog({ source: "cached", error: "offline" })),
    ).toBe(catalogCopy.source.cachedOffline.replace("{{when}}", WHEN_TEXT));
    expect(
      catalogSourceLine(
        catalog({ source: "cached", fetchedAt: undefined, generatedAt: "" }),
      ),
    ).toBe(catalogCopy.source.cachedUnknown);
    expect(
      catalogSourceLine(
        catalog({
          source: "cached",
          fetchedAt: undefined,
          generatedAt: "",
          error: "offline",
        }),
      ),
    ).toBe(catalogCopy.source.cachedUnknownOffline);
    expect(catalogSourceLine(catalog())).toBe(
      catalogCopy.source.remote.replace("{{when}}", WHEN_TEXT),
    );
    expect(
      catalogSourceLine(catalog({ fetchedAt: undefined, generatedAt: "" })),
    ).toBe(catalogCopy.source.remoteUnknown);
  });

  it("passes an unparseable timestamp through untouched", () => {
    expect(catalogSourceLine(catalog({ fetchedAt: "whenever" }))).toBe(
      catalogCopy.source.remote.replace("{{when}}", "whenever"),
    );
  });
});

describe("SkillCatalogList", () => {
  it("loads the shelf and shows each entry with its size", async () => {
    renderList();

    expect(screen.getByText(catalogCopy.loading)).toBeInTheDocument();
    expect(await screen.findByTestId("skill-shelf-row-oleafly-latex")).toBeInTheDocument();
    expect(screen.getByText(catalogCopy.title)).toBeInTheDocument();
    expect(screen.getByText(catalogCopy.description)).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(skills.size.kilobytes.replace("{{value}}", "2.4"))),
    ).toBeInTheDocument();
    expect(
      screen.getByText(catalogCopy.source.remote.replace("{{when}}", WHEN_TEXT)),
    ).toBeInTheDocument();
  });

  it("hides bundled skills and says the shelf is empty", async () => {
    mocks.skillsCatalog.mockResolvedValue(
      catalog({ skills: [entry({ bundled: true })] }),
    );
    renderList();

    expect(await screen.findByText(catalogCopy.empty)).toBeInTheDocument();
  });

  it("reports a catalog that cannot be read", async () => {
    mocks.skillsCatalog.mockRejectedValue(new Error("no network"));
    renderList();

    expect(await screen.findByRole("alert")).toHaveTextContent("no network");
  });

  it("refreshes the catalog on request", async () => {
    const user = userEvent.setup();
    renderList();

    await screen.findByTestId("skill-shelf-row-oleafly-latex");
    await user.click(screen.getByTestId("skills-catalog-refresh"));
    await waitFor(() => expect(mocks.skillsCatalog).toHaveBeenCalledWith(true));
  });

  it("installs a skill and confirms it", async () => {
    const user = userEvent.setup();
    renderList();

    await user.click(await screen.findByTestId("skill-shelf-install-oleafly-latex"));
    await waitFor(() => expect(mocks.skillsInstall).toHaveBeenCalledWith("oleafly-latex"));
    expect(await screen.findByRole("status")).toHaveTextContent(
      catalogCopy.messages.installed.replace("{{name}}", "Oleafly LaTeX"),
    );
  });

  it("reports an install that fails", async () => {
    const user = userEvent.setup();
    mocks.skillsInstall.mockRejectedValue(new Error("checksum mismatch"));
    renderList();

    await user.click(await screen.findByTestId("skill-shelf-install-oleafly-latex"));
    expect(await screen.findByRole("alert")).toHaveTextContent("checksum mismatch");
  });

  it("updates and uninstalls an installed skill", async () => {
    const user = userEvent.setup();
    mocks.skillsCatalog.mockResolvedValue(
      catalog({
        skills: [entry({ installed: true, updateAvailable: true, bytes: 900 })],
      }),
    );
    renderList();

    await user.click(await screen.findByTestId("skill-shelf-update-oleafly-latex"));
    await waitFor(() => expect(mocks.skillsInstall).toHaveBeenCalled());

    await user.click(screen.getByTestId("skill-shelf-uninstall-oleafly-latex"));
    await waitFor(() =>
      expect(mocks.skillsUninstall).toHaveBeenCalledWith("oleafly-latex"),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      catalogCopy.messages.removed.replace("{{name}}", "Oleafly LaTeX"),
    );
  });

  it("reports an uninstall that fails", async () => {
    const user = userEvent.setup();
    mocks.skillsCatalog.mockResolvedValue(
      catalog({ skills: [entry({ installed: true })] }),
    );
    mocks.skillsUninstall.mockRejectedValue(new Error("in use"));
    renderList();

    await user.click(await screen.findByTestId("skill-shelf-uninstall-oleafly-latex"));
    expect(await screen.findByRole("alert")).toHaveTextContent("in use");
  });

  it("shows each install phase while a download runs", async () => {
    const user = userEvent.setup();
    let release: () => void = () => {};
    mocks.skillsInstall.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    renderList();

    await user.click(await screen.findByTestId("skill-shelf-install-oleafly-latex"));

    const send = (payload: Partial<SkillAssetProgress>) =>
      emit?.({
        payload: {
          kind: "skill",
          id: "oleafly-latex",
          phase: "download",
          received: 0,
          total: 0,
          ...payload,
        } as SkillAssetProgress,
      });

    send({});
    expect(
      await screen.findByText(catalogCopy.progress.downloading),
    ).toBeInTheDocument();

    send({ received: 5, total: 10 });
    expect(
      await screen.findByText(
        catalogCopy.progress.downloadingPercent.replace("{{percent}}", "50"),
      ),
    ).toBeInTheDocument();

    send({ phase: "extract" });
    expect(
      await screen.findByText(catalogCopy.progress.extracting),
    ).toBeInTheDocument();

    send({ phase: "extract", received: 1, total: 4 });
    expect(
      await screen.findByText(
        catalogCopy.progress.extractingPercent.replace("{{percent}}", "25"),
      ),
    ).toBeInTheDocument();

    send({ phase: "done" });
    expect(
      await screen.findByText(catalogCopy.progress.finishing),
    ).toBeInTheDocument();

    send({ phase: "error" });
    expect(await screen.findByText(catalogCopy.progress.failed)).toBeInTheDocument();

    send({ phase: "error", message: "disk full" });
    expect(await screen.findByText(/disk full/u)).toBeInTheDocument();

    release();
    await waitFor(() => expect(mocks.skillsCatalog).toHaveBeenCalledTimes(2));
  });

  it("ignores progress for anything that is not a skill", async () => {
    renderList();
    await screen.findByTestId("skill-shelf-row-oleafly-latex");

    emit?.({
      payload: { kind: "font", id: "lato" } as unknown as SkillAssetProgress,
    });

    expect(screen.getByTestId("skill-shelf-row-oleafly-latex")).toBeInTheDocument();
  });
});
