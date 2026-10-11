// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  overleafStatus: vi.fn(),
  overleafSignOut: vi.fn(),
}));

vi.mock("@/lib/overleaf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/overleaf")>()),
  ...api,
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn(async () => {}) }));

import { useOverleafImportStore } from "@/store/overleaf-import";
import { OverleafSection } from "./OverleafSection";

const SERVER = "https://www.overleaf.com";

beforeEach(() => {
  api.overleafStatus.mockReset();
  api.overleafSignOut.mockReset();
  useOverleafImportStore.setState({ server: SERVER, status: null, phase: "idle", error: null });
});

describe("OverleafSection", () => {
  it("shows the signed-in account and signs out", async () => {
    api.overleafStatus.mockResolvedValue({ server: SERVER, signedIn: true, email: "ada@uni.edu" });
    api.overleafSignOut.mockResolvedValue({ server: SERVER, signedIn: false, email: null });
    render(<OverleafSection />);
    expect(await screen.findByTestId("overleaf-connected")).toHaveTextContent(
      "Signed in as ada@uni.edu on www.overleaf.com",
    );
    fireEvent.click(screen.getByTestId("overleaf-settings-sign-out"));
    expect(
      await screen.findByText("Not signed in. Oleafly asks you to sign in when you import projects."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("names the server when the account has no email and reports a failed sign-out", async () => {
    api.overleafStatus.mockResolvedValue({ server: "https://latex.uni.edu", signedIn: true, email: null });
    api.overleafSignOut.mockRejectedValue(new Error("locked"));
    render(<OverleafSection />);
    expect(await screen.findByTestId("overleaf-connected")).toHaveTextContent("Signed in on latex.uni.edu");
    fireEvent.click(screen.getByTestId("overleaf-settings-sign-out"));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Oleafly could not sign out of Overleaf."),
    );
  });
});
