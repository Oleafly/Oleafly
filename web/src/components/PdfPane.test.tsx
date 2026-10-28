import { act, fireEvent, render, screen } from "@testing-library/react";
import { forwardRef } from "react";
import { describe, expect, it, vi } from "vitest";
import type { WebApi } from "../api";
import type { CollabOutputInfo } from "../protocol";
import { resetWebState, useWeb } from "../store";
import { dateTime } from "./format";
import { outputKey, PdfPane } from "./PdfPane";

vi.mock("@oleafly/preview", () => ({
  PdfViewer: forwardRef<unknown, { data: Uint8Array; documentIdentity: string }>(function PdfViewer(props, _ref) {
    return (
      <div data-testid="pdf-viewer" data-identity={props.documentIdentity}>
        {props.data.length}
      </div>
    );
  }),
}));

function api(output: WebApi["output"]): WebApi {
  return {
    me: vi.fn(),
    projects: vi.fn(),
    project: vi.fn(),
    blob: vi.fn(),
    output,
    signOut: vi.fn(),
  } as unknown as WebApi;
}

const COMPILED: CollabOutputInfo = {
  kind: "pdf",
  size: 3,
  compiledBy: "ana",
  compiledAt: Date.UTC(2026, 9, 24, 15, 30),
  mainFile: "main.tex",
};

function people() {
  return { ana: { accountId: "ana", name: "Ana Ruiz", avatarUrl: null, login: null } };
}

describe("PdfPane", () => {
  it("explains that nobody has compiled yet and does not fetch", () => {
    resetWebState({ projectId: "p1" });
    const output = vi.fn();
    render(<PdfPane api={api(output)} projectId="p1" />);
    expect(screen.getByTestId("pdf-empty")).toHaveTextContent("No PDF yet");
    expect(screen.getByTestId("pdf-empty")).toHaveTextContent(
      "The PDF appears here after someone compiles the project in the Oleafly app.",
    );
    expect(screen.getByTestId("pdf-label")).toBeEmptyDOMElement();
    expect(output).not.toHaveBeenCalled();
  });

  it("shows who compiled the PDF and when, then the PDF", async () => {
    resetWebState({ projectId: "p1", output: [COMPILED], people: people() });
    const output = vi.fn(async () => new Uint8Array([1, 2, 3]));
    render(<PdfPane api={api(output)} projectId="p1" />);
    expect(screen.getByTestId("pdf-label")).toHaveTextContent(`Compiled by Ana Ruiz, ${dateTime(COMPILED.compiledAt)}`);
    expect(await screen.findByTestId("pdf-viewer")).toHaveTextContent("3");
    expect(output).toHaveBeenCalledWith("p1", "pdf");
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute("href", "/web/api/projects/p1/output/pdf");
  });

  it("loads the new PDF when an output frame reports a newer compile", async () => {
    resetWebState({ projectId: "p1", output: [COMPILED], people: people() });
    const output = vi
      .fn<WebApi["output"]>()
      .mockResolvedValueOnce(new Uint8Array([1, 2, 3]))
      .mockResolvedValueOnce(new Uint8Array([1, 2, 3, 4, 5]));
    render(<PdfPane api={api(output)} projectId="p1" />);
    expect(await screen.findByTestId("pdf-viewer")).toHaveTextContent("3");
    await act(async () => {
      useWeb.setState({ output: [{ ...COMPILED, compiledAt: COMPILED.compiledAt + 60_000, size: 5 }] });
    });
    expect(await screen.findByText("5")).toBeInTheDocument();
    expect(output).toHaveBeenCalledTimes(2);
  });

  it("offers a retry when the PDF cannot be fetched", async () => {
    resetWebState({ projectId: "p1", output: [COMPILED], people: people() });
    const output = vi
      .fn<WebApi["output"]>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(new Uint8Array([9]));
    render(<PdfPane api={api(output)} projectId="p1" />);
    expect(await screen.findByText("The PDF could not be loaded.")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(await screen.findByTestId("pdf-viewer")).toHaveTextContent("1");
  });

  it("goes back to the empty state when the server has no PDF after all", async () => {
    resetWebState({ projectId: "p1", output: [COMPILED], people: people() });
    render(<PdfPane api={api(vi.fn(async () => null))} projectId="p1" />);
    expect(await screen.findByTestId("pdf-empty")).toHaveTextContent("No PDF yet");
    expect(screen.queryByTestId("pdf-viewer")).toBeNull();
  });

  it("keys a compile by its time, size and author", () => {
    expect(outputKey(undefined)).toBeNull();
    expect(outputKey(COMPILED)).toBe(`${COMPILED.compiledAt}:3:ana`);
  });
});
