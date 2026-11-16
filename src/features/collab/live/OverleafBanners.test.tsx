// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import { useSettingsStore } from "@/store/settings";
import { useCollabLiveStore } from "./live-store";
import { OverleafBanners } from "./OverleafBanners";

const LINK = { server: "https://latex.uni.edu", remoteId: "6af963ebc9037022065bb53f", signedIn: false, paused: false };
const TYPED_AS = { userId: "u-ada", email: "ada@uni.edu" };

function kept(path: string, copy: string) {
  return { id: path, path, copy, kind: "beside" as const, by: TYPED_AS.email };
}

beforeAll(async () => {
  await loadNamespace("collab");
});

afterEach(() => {
  useCollabLiveStore.setState({ status: null, overleaf: null, accountChanged: null });
  vi.restoreAllMocks();
});

describe("OverleafBanners", () => {
  it("says the session is signed out and opens the sign-in settings", async () => {
    const openSettingsAt = vi.spyOn(useSettingsStore.getState(), "openSettingsAt").mockImplementation(() => {});
    useCollabLiveStore.setState({ status: { state: "signed_out" }, overleaf: LINK });
    render(<OverleafBanners />);
    const banner = screen.getByTestId("overleaf-signed-out-banner");
    expect(banner).toHaveTextContent(
      "You're signed out of latex.uni.edu, so this project isn't syncing. You can keep typing.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(openSettingsAt).toHaveBeenCalledWith("integrations");
  });

  it("shows nothing while the session is online", () => {
    useCollabLiveStore.setState({ status: { state: "online" }, overleaf: LINK });
    render(<OverleafBanners />);
    expect(screen.queryByTestId("overleaf-signed-out-banner")).not.toBeInTheDocument();
    expect(screen.queryByTestId("overleaf-account-changed-banner")).not.toBeInTheDocument();
  });

  it("names the one copy kept after an account switch and goes away when dismissed", async () => {
    const copy = "main (from ada@uni.edu).tex";
    useCollabLiveStore.setState({
      accountChanged: { projectId: "p1", typedAs: TYPED_AS, files: [kept("main.tex", copy)] },
    });
    render(<OverleafBanners />);
    const banner = screen.getByTestId("overleaf-account-changed-banner");
    expect(banner).toHaveTextContent(
      `the changes you made as ada@uni.edu weren't sent. They're kept as ${copy}.`,
    );
    expect(banner.querySelector("ul")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("overleaf-account-changed-banner")).not.toBeInTheDocument();
  });

  it("lists every copy when several files were kept", () => {
    useCollabLiveStore.setState({
      accountChanged: {
        projectId: "p1",
        typedAs: TYPED_AS,
        files: [kept("main.tex", "main (from ada@uni.edu).tex"), kept("intro.tex", "intro (from ada@uni.edu).tex")],
      },
    });
    render(<OverleafBanners />);
    const banner = screen.getByTestId("overleaf-account-changed-banner");
    expect(banner).toHaveTextContent("They're kept as copies next to their files:");
    expect(banner).toHaveTextContent("main.tex is kept as main (from ada@uni.edu).tex");
    expect(banner).toHaveTextContent("intro.tex is kept as intro (from ada@uni.edu).tex");
  });

  it("stays quiet after an account switch that kept nothing", () => {
    useCollabLiveStore.setState({ accountChanged: { projectId: "p1", typedAs: TYPED_AS, files: [] } });
    render(<OverleafBanners />);
    expect(screen.queryByTestId("overleaf-account-changed-banner")).not.toBeInTheDocument();
  });
});
