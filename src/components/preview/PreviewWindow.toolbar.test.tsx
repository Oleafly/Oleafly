// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readCompiledPdf: vi.fn(),
  gotoPage: vi.fn(),
  getFitScale: vi.fn(() => 1),
  activateOutlineItem: vi.fn(),
  findNext: vi.fn(),
  findPrevious: vi.fn(),
  loadStatus: "ready" as string,
  loadMessage: undefined as string | undefined,
  outlineItems: [] as unknown[],
  lastProps: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/tauri", () => ({
  readCompiledPdf: mocks.readCompiledPdf,
  appendAppLog: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock("@/components/pdf/PdfViewer", async () => {
  const react = await import("react");
  interface StubProps {
    data: Uint8Array;
    documentIdentity: string;
    onPageChange?: (current: number, total: number) => void;
    onLoadStateChange?: (state: Record<string, unknown>) => void;
    onOutlineStateChange?: (state: Record<string, unknown>) => void;
    onSearchStateChange?: (state: Record<string, unknown>) => void;
  }
  const PdfViewer = react.forwardRef<unknown, StubProps>((props, ref) => {
    mocks.lastProps = props as unknown as Record<string, unknown>;
    react.useImperativeHandle(ref, () => ({
      gotoPage: mocks.gotoPage,
      getFitScale: mocks.getFitScale,
      activateOutlineItem: mocks.activateOutlineItem,
      findNext: mocks.findNext,
      findPrevious: mocks.findPrevious,
    }));
    const announce = react.useRef(props);
    announce.current = props;
    react.useEffect(() => {
      announce.current.onPageChange?.(1, 4);
      announce.current.onLoadStateChange?.({
        status: mocks.loadStatus,
        documentIdentity: props.documentIdentity,
        ...(mocks.loadMessage ? { message: mocks.loadMessage } : {}),
      });
      announce.current.onOutlineStateChange?.({
        status: "ready",
        items: mocks.outlineItems,
      });
      announce.current.onSearchStateChange?.({
        status: "success",
        query: "theorem",
        current: 1,
        total: 2,
        scannedPages: 4,
        totalPages: 4,
      });
    }, [props.documentIdentity]);
    return <div data-testid="detached-pdf-bytes" />;
  });
  return { PdfViewer };
});

import enPreview from "@/i18n/locales/en/preview.json" with { type: "json" };
import { PreviewWindow } from "./PreviewWindow";

async function renderHarness() {
  const view = render(
    <PreviewWindow disableNativeBridge harnessBytes={new Uint8Array([7, 7])} />,
  );
  await waitFor(() =>
    expect(screen.getByLabelText(enPreview.zoom.in)).toBeInTheDocument(),
  );
  return view;
}

beforeEach(() => {
  window.history.replaceState({}, "", "/?view=preview&project=alpha");
  mocks.readCompiledPdf.mockReset();
  mocks.gotoPage.mockReset();
  mocks.activateOutlineItem.mockReset();
  mocks.findNext.mockReset();
  mocks.findPrevious.mockReset();
  mocks.loadStatus = "ready";
  mocks.loadMessage = undefined;
  mocks.outlineItems = [];
});

describe("detached preview toolbar", () => {
  it("labels every control it offers", async () => {
    await renderHarness();
    for (const label of [
      enPreview.outline.open,
      enPreview.search.open,
      enPreview.pageLayout.single,
      enPreview.pageLayout.double,
      enPreview.pages.previous,
      enPreview.pages.next,
      enPreview.pages.number,
      enPreview.zoom.in,
      enPreview.zoom.out,
      enPreview.window.rotateLabel,
      enPreview.window.invertLabel,
      enPreview.actions.readerView,
      enPreview.actions.downloadDisplayedPdf,
      enPreview.viewer.scrollArea,
    ]) {
      expect(screen.getByLabelText(label), label).toBeInTheDocument();
    }
    expect(
      screen.getByText(enPreview.pages.ofTotal.replace("{{total}}", "4")),
    ).toBeInTheDocument();
  });

  it("zooms and rotates the detached document", async () => {
    await renderHarness();
    const user = userEvent.setup();
    const initial = mocks.lastProps?.scale as number;
    await user.click(screen.getByLabelText(enPreview.zoom.in));
    await waitFor(() =>
      expect(mocks.lastProps?.scale as number).toBeGreaterThan(initial),
    );
    await user.click(screen.getByLabelText(enPreview.zoom.out));
    await waitFor(() => expect(mocks.lastProps?.scale as number).toBe(initial));
    await user.click(screen.getByLabelText(enPreview.window.rotateLabel));
    await waitFor(() => expect(mocks.lastProps?.rotation).toBe(90));
  });

  it("presses the invert and reader toggles", async () => {
    await renderHarness();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(enPreview.window.invertLabel));
    await waitFor(() =>
      expect(screen.getByLabelText(enPreview.window.invertLabel)).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    await user.click(screen.getByLabelText(enPreview.actions.readerView));
    await waitFor(() =>
      expect(screen.getByLabelText(enPreview.actions.readerView)).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
  });

  it("opens the outline panel and activates an entry", async () => {
    mocks.outlineItems = [
      {
        id: "top",
        title: "Results",
        external: false,
        children: [
          { id: "child", title: "Ablation", external: true, children: [] },
        ],
      },
    ];
    await renderHarness();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(enPreview.outline.open));
    expect(screen.getByLabelText(enPreview.outline.panel)).toBeInTheDocument();
    expect(screen.getByText(enPreview.outline.externalBadge)).toBeInTheDocument();
    expect(screen.getByLabelText(enPreview.outline.open)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await user.click(screen.getByRole("button", { name: /Ablation/ }));
    expect(mocks.activateOutlineItem).toHaveBeenCalledWith("child");
    await waitFor(() =>
      expect(screen.getByLabelText(enPreview.outline.open)).toHaveAttribute(
        "aria-expanded",
        "false",
      ),
    );
  });

  it("says the outline is empty when the document has none", async () => {
    await renderHarness();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(enPreview.outline.open));
    expect(screen.getByText(enPreview.outline.empty)).toBeInTheDocument();
  });

  it("searches the detached document", async () => {
    await renderHarness();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(enPreview.search.open));
    const input = await screen.findByLabelText(enPreview.search.input);
    await user.type(input, "theorem");
    expect(input).toHaveValue("theorem");
    await user.click(screen.getByLabelText(enPreview.search.next));
    expect(mocks.findNext).toHaveBeenCalled();
    await user.click(screen.getByLabelText(enPreview.search.previous));
    expect(mocks.findPrevious).toHaveBeenCalled();
    await user.click(screen.getByLabelText(enPreview.search.close));
    await waitFor(() =>
      expect(screen.queryByLabelText(enPreview.search.input)).not.toBeInTheDocument(),
    );
  });

  it("steps a two-page spread by two pages", async () => {
    await renderHarness();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(enPreview.pageLayout.double));
    await user.click(screen.getByLabelText(enPreview.pages.next));
    expect(mocks.gotoPage).toHaveBeenLastCalledWith(3);
    await user.click(screen.getByLabelText(enPreview.pageLayout.single));
    await user.click(screen.getByLabelText(enPreview.pages.next));
    expect(mocks.gotoPage).toHaveBeenLastCalledWith(2);
  });

  it("explains a load failure the viewer reports", async () => {
    mocks.loadStatus = "invalid";
    render(
      <PreviewWindow disableNativeBridge harnessBytes={new Uint8Array([7])} />,
    );
    expect(await screen.findByText(enPreview.viewer.invalidTitle)).toBeInTheDocument();
    expect(screen.getByText(enPreview.viewer.loadFailedDetail)).toBeInTheDocument();
  });

  it("asks for the password of a locked document", async () => {
    mocks.loadStatus = "password_required";
    mocks.loadMessage = "Encrypted";
    render(
      <PreviewWindow disableNativeBridge harnessBytes={new Uint8Array([7])} />,
    );
    expect(await screen.findByText(enPreview.password.title)).toBeInTheDocument();
    const user = userEvent.setup();
    const field = screen.getByLabelText(enPreview.password.label);
    const submit = screen.getByRole("button", { name: enPreview.password.submit });
    expect(submit).toBeDisabled();
    await user.type(field, "secret");
    expect(submit).toBeEnabled();
  });
});
