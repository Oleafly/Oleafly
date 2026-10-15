// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCollab from "@/i18n/locales/en/collab.json" with { type: "json" };
import { loadNamespace } from "@/i18n";
import { check, collabError } from "../tests/fixtures";

const mocks = vi.hoisted(() => ({ collabServerTest: vi.fn() }));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  ...mocks,
}));
vi.mock("@/lib/tauri-collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri-collab")>()),
  ...mocks,
}));

import { ChecksSection } from "./ChecksSection";

beforeAll(async () => {
  await loadNamespace("collab");
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ChecksSection", () => {
  it("tests the connection as soon as it opens and again on request", async () => {
    mocks.collabServerTest.mockResolvedValue([check("reachable", "pass"), check("https", "pass")]);
    const user = userEvent.setup();
    const { container } = render(<ChecksSection url="https://collab.uni.edu" />);
    expect(screen.getByText(enCollab.console.checks.description)).toBeInTheDocument();
    await waitFor(() => expect(container.querySelectorAll("[data-check]")).toHaveLength(2));
    expect(mocks.collabServerTest).toHaveBeenCalledWith("https://collab.uni.edu");
    await user.click(screen.getByRole("button", { name: enCollab.section.server.test }));
    await waitFor(() => expect(mocks.collabServerTest).toHaveBeenCalledTimes(2));
  });

  it("shows progress and then why the test could not run", async () => {
    mocks.collabServerTest.mockRejectedValue(collabError("unreachable"));
    render(<ChecksSection url="https://collab.uni.edu" />);
    expect(screen.getByText(enCollab.section.checks.running)).toBeInTheDocument();
    expect(await screen.findByText(enCollab.errors.unreachable)).toBeInTheDocument();
  });
});
