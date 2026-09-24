// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadReleaseNotesRenderer, openableReleaseLink, ReleaseNotes } from "./ReleaseNotes";

afterEach(cleanup);

describe("openableReleaseLink", () => {
  it("allows only web and mail addresses", () => {
    expect(openableReleaseLink("https://github.com/Oleafly/Oleafly")).toBe("https://github.com/Oleafly/Oleafly");
    expect(openableReleaseLink("mailto:support@oleafly.com")).toBe("mailto:support@oleafly.com");
    expect(openableReleaseLink("javascript:alert(1)")).toBeNull();
    expect(openableReleaseLink("file:///etc/passwd")).toBeNull();
    expect(openableReleaseLink("/relative/path")).toBeNull();
    expect(openableReleaseLink(undefined)).toBeNull();
  });
});

describe("ReleaseNotes before its renderer loads", () => {
  it("shows the notes as plain text, then renders the markdown", async () => {
    render(<ReleaseNotes source={"### Fixed\n\n- One fix."} onOpenLink={vi.fn()} />);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.getByTestId("release-notes")).toHaveTextContent("### Fixed - One fix.");
    expect(await screen.findByRole("heading", { level: 3, name: "Fixed" })).toBeInTheDocument();
    expect(screen.getByText("One fix.")).toBeInTheDocument();
  });
});

describe("ReleaseNotes", () => {
  beforeAll(() => loadReleaseNotesRenderer());

  it("opens links through the handler instead of navigating the window", () => {
    const onOpenLink = vi.fn();
    render(<ReleaseNotes source="See the [notes](https://github.com/Oleafly/Oleafly)." onOpenLink={onOpenLink} />);
    const link = screen.getByRole("link", { name: /notes/ });
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(onOpenLink).toHaveBeenCalledWith("https://github.com/Oleafly/Oleafly");
  });

  it("renders unsafe links as plain text", () => {
    render(<ReleaseNotes source="[run me](javascript:alert(1)) and [local](file:///etc/hosts)" onOpenLink={vi.fn()} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("run me")).toBeInTheDocument();
  });

  it("renders section headings as plain headings", () => {
    render(<ReleaseNotes source={"### Fixed\n\n- One fix."} onOpenLink={vi.fn()} />);
    const heading = screen.getByRole("heading", { level: 3, name: "Fixed" });
    expect(heading.querySelector("svg")).toBeNull();
    expect(screen.getByText("One fix.")).toBeInTheDocument();
  });

  it("opens an image at full size and drops images that are not web addresses", () => {
    const onOpenLink = vi.fn();
    render(
      <ReleaseNotes
        source={"![Screenshot](https://cdn.oleafly.com/shot.png)\n\n![Local](file:///tmp/a.png)"}
        onOpenLink={onOpenLink}
      />,
    );
    const images = screen.getAllByRole("img");
    expect(images).toHaveLength(1);
    fireEvent.click(images[0]);
    expect(onOpenLink).toHaveBeenCalledWith("https://cdn.oleafly.com/shot.png");
  });

  it("copies a code block to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<ReleaseNotes source={"```bash\noleafly doctor --json\n```"} onOpenLink={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("oleafly doctor --json"));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("never renders raw HTML from the notes", () => {
    const { container } = render(<ReleaseNotes source={'<img src=x onerror="alert(1)"><script>alert(2)</script>'} onOpenLink={vi.fn()} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img[onerror]")).toBeNull();
  });
});
