// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import enPreview from "@/i18n/locales/en/preview.json" with { type: "json" };

const mocks = vi.hoisted(() => ({
  openUrl: vi.fn(async () => {}),
  logError: vi.fn(),
  logger: null as null | ((scope: string, message: string) => void),
  props: null as null | {
    t: (key: string, params?: Record<string, unknown>) => string;
    onOpenLink: (url: string) => void;
    documentIdentity?: string;
  },
}));

vi.mock("@tauri-apps/plugin-shell", () => ({ open: mocks.openUrl }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@oleafly/preview/controller", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@oleafly/preview/controller")>()),
  setPdfLogger: (fn: (scope: string, message: string) => void) => {
    mocks.logger = fn;
  },
}));
vi.mock("@oleafly/preview", () => ({
  PdfViewer: (props: NonNullable<typeof mocks.props>) => {
    mocks.props = props;
    return <div data-testid="pdf-core">{props.documentIdentity}</div>;
  },
}));

import { PdfViewer } from "./PdfViewer";

beforeEach(() => {
  mocks.props = null;
  mocks.openUrl.mockClear();
});

describe("PdfViewer", () => {
  it("shows a loading state until the viewer loads, then passes the props through", async () => {
    render(<PdfViewer data={null} documentIdentity="compile-7" scale={1} />);

    expect(screen.getByRole("status")).toHaveTextContent(enEditor.preview.loading);
    expect(await screen.findByTestId("pdf-core")).toHaveTextContent("compile-7");
  });

  it("translates the viewer's strings from the preview catalog", async () => {
    render(<PdfViewer data={null} documentIdentity="compile-7" scale={1} />);
    await screen.findByTestId("pdf-core");

    expect(mocks.props?.t("error.passwordRequired")).toBe(
      enPreview.package.error.passwordRequired,
    );
  });

  it("opens only safe external links from the PDF", async () => {
    render(<PdfViewer data={null} documentIdentity="compile-7" scale={1} />);
    await screen.findByTestId("pdf-core");

    mocks.props?.onOpenLink("https://doi.org/10.1000/xyz");
    mocks.props?.onOpenLink("javascript:alert(1)");

    expect(mocks.openUrl).toHaveBeenCalledTimes(1);
    expect(mocks.openUrl).toHaveBeenCalledWith("https://doi.org/10.1000/xyz");
  });

  it("sends the viewer's diagnostics to the app log", () => {
    mocks.logger?.("synctex", "no box for line 12");

    expect(mocks.logError).toHaveBeenCalledWith("synctex", "no box for line 12");
  });
});
