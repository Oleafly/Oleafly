// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/native-file-dialog", () => ({ pickOpenPath: vi.fn() }));
vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  importTemplateFromPath: vi.fn(),
}));
vi.mock("@/lib/overleaf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/overleaf")>()),
  overleafStatus: vi.fn(),
  overleafSignIn: vi.fn(),
  overleafListProjects: vi.fn(),
  overleafTemplateDetails: vi.fn(),
  overleafTemplatePdf: vi.fn(),
  overleafImportTemplate: vi.fn(),
  overleafSaveProjectAsTemplate: vi.fn(),
}));
vi.mock("@/features/custom-templates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/custom-templates")>()),
  firstPagePng: vi.fn(async () => "data:image/png;base64,QUJD"),
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn(async () => {}) }));

import enLibrary from "@/i18n/locales/en/library.json" with { type: "json" };
import { firstPagePng } from "@/features/custom-templates";
import { pickOpenPath } from "@/lib/native-file-dialog";
import {
  DEFAULT_OVERLEAF_SERVER,
  overleafImportTemplate,
  overleafListProjects,
  overleafSaveProjectAsTemplate,
  overleafSignIn,
  overleafStatus,
  overleafTemplateDetails,
  overleafTemplatePdf,
  type OverleafProject,
} from "@/lib/overleaf";
import { importTemplateFromPath } from "@/lib/tauri";
import { useOverleafImportStore } from "@/store/overleaf-import";
import { TemplateImportDialog } from "./TemplateImportDialog";

const copy = enLibrary.customTemplates.import;
const LINK = "https://www.overleaf.com/latex/templates/ieee-conference-template/grfzhhncsfqn";
const DETAILS = {
  server: DEFAULT_OVERLEAF_SERVER,
  link: LINK,
  title: "IEEE Conference Template",
  author: "IEEE",
  license: "Other (as stated in the work)",
  description: "A starter file for IEEE conference papers.",
  compiler: "pdflatex",
  mainFile: "conference_101719.tex",
  hasPdf: true,
};
const signedIn = { server: DEFAULT_OVERLEAF_SERVER, signedIn: true, email: "ada@uni.edu" };
const signedOut = { server: DEFAULT_OVERLEAF_SERVER, signedIn: false, email: null };

function remote(id: string, name: string, over: Partial<OverleafProject> = {}): OverleafProject {
  return {
    id,
    name,
    ownerName: "Ada Lovelace",
    owned: true,
    access: "owner",
    lastUpdated: null,
    lastUpdatedBy: null,
    archived: false,
    importedAs: null,
    ...over,
  };
}

function renderDialog() {
  const onImported = vi.fn();
  const onClose = vi.fn();
  render(<TemplateImportDialog open onClose={onClose} onImported={onImported} />);
  return { onImported, onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  useOverleafImportStore.setState({
    server: DEFAULT_OVERLEAF_SERVER,
    status: null,
    projects: [],
    phase: "idle",
    error: null,
    selected: [],
    progress: {},
    importing: false,
    run: null,
  });
  vi.mocked(importTemplateFromPath).mockResolvedValue("lab-thesis-abc123");
  vi.mocked(overleafTemplateDetails).mockResolvedValue(DETAILS);
  vi.mocked(overleafTemplatePdf).mockResolvedValue(new ArrayBuffer(8));
  vi.mocked(overleafImportTemplate).mockResolvedValue("ieee-abc123");
  vi.mocked(overleafSaveProjectAsTemplate).mockResolvedValue("lab-master-abc123");
  vi.mocked(overleafStatus).mockResolvedValue(signedIn);
  vi.mocked(overleafSignIn).mockResolvedValue(signedIn);
});

describe("TemplateImportDialog", () => {
  it("offers four sources", () => {
    renderDialog();
    expect(screen.getByTestId("template-import-dialog")).toHaveTextContent(copy.title);
    for (const id of ["zip", "folder", "link", "account"]) {
      expect(screen.getByTestId(`template-import-${id}`)).toBeEnabled();
    }
  });

  it("imports a ZIP under a name taken from the file", async () => {
    vi.mocked(pickOpenPath).mockResolvedValue("/tmp/downloads/Lab Thesis.zip");
    const { onImported } = renderDialog();

    fireEvent.click(screen.getByTestId("template-import-zip"));

    const name = await screen.findByTestId("template-import-name");
    expect(name).toHaveValue("Lab Thesis");
    expect(pickOpenPath).toHaveBeenCalledWith(
      expect.objectContaining({ filters: [expect.objectContaining({ extensions: ["zip"] })] }),
    );
    expect(screen.getByText("From Lab Thesis.zip")).toBeInTheDocument();

    fireEvent.change(name, { target: { value: "  Our lab thesis " } });
    fireEvent.click(screen.getByTestId("template-import-save"));

    await waitFor(() =>
      expect(importTemplateFromPath).toHaveBeenCalledWith(
        "/tmp/downloads/Lab Thesis.zip",
        "Our lab thesis",
      ),
    );
    expect(onImported).toHaveBeenCalledWith("lab-thesis-abc123", "Our lab thesis");
  });

  it("imports a folder, shows a failure in place, and keeps the dialog open", async () => {
    vi.mocked(pickOpenPath).mockResolvedValue("C:\\Users\\ada\\Thesis Template\\");
    vi.mocked(importTemplateFromPath).mockRejectedValue(new Error("No document in this folder"));
    const { onImported } = renderDialog();

    fireEvent.click(screen.getByTestId("template-import-folder"));

    const name = await screen.findByTestId("template-import-name");
    expect(name).toHaveValue("Thesis Template");
    expect(pickOpenPath).toHaveBeenCalledWith(expect.objectContaining({ directory: true }));
    fireEvent.click(screen.getByTestId("template-import-save"));

    expect(await screen.findByRole("alert")).toHaveTextContent("No document in this folder");
    expect(onImported).not.toHaveBeenCalled();
    expect(screen.getByTestId("template-import-save")).toBeEnabled();
  });

  it("stays on the sources when the picker is dismissed, and Back returns there", async () => {
    vi.mocked(pickOpenPath).mockResolvedValueOnce(null);
    renderDialog();

    fireEvent.click(screen.getByTestId("template-import-zip"));
    await waitFor(() => expect(pickOpenPath).toHaveBeenCalled());
    expect(screen.queryByTestId("template-import-name")).not.toBeInTheDocument();

    vi.mocked(pickOpenPath).mockResolvedValueOnce("/tmp/a.zip");
    fireEvent.click(screen.getByTestId("template-import-zip"));
    await screen.findByTestId("template-import-name");
    fireEvent.click(screen.getByTestId("template-import-back"));
    expect(screen.getByTestId("template-import-zip")).toBeInTheDocument();
  });

  it("looks up a gallery link, signs in when needed, then imports it", async () => {
    vi.mocked(overleafStatus).mockResolvedValue(signedOut);
    const { onImported } = renderDialog();

    fireEvent.click(screen.getByTestId("template-import-link"));
    fireEvent.change(screen.getByTestId("template-import-link-input"), {
      target: { value: ` ${LINK} ` },
    });
    fireEvent.click(screen.getByTestId("template-import-look-up"));

    const details = await screen.findByTestId("template-import-details");
    expect(overleafTemplateDetails).toHaveBeenCalledWith(DEFAULT_OVERLEAF_SERVER, LINK);
    expect(details).toHaveTextContent("IEEE Conference Template");
    expect(details).toHaveTextContent("By IEEE");
    expect(details).toHaveTextContent("Other (as stated in the work)");
    expect(screen.getByTestId("template-import-name")).toHaveValue("IEEE Conference Template");
    expect(await screen.findByAltText("First page of IEEE Conference Template")).toHaveAttribute(
      "src",
      "data:image/png;base64,QUJD",
    );
    expect(overleafTemplatePdf).toHaveBeenCalledWith(DEFAULT_OVERLEAF_SERVER, LINK);
    expect(screen.getByText(copy.copyNote)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("template-import-link-save"));
    const signIn = await screen.findByTestId("template-import-sign-in");
    expect(screen.getByText(copy.signInNeeded)).toBeInTheDocument();
    expect(overleafImportTemplate).not.toHaveBeenCalled();

    vi.mocked(overleafStatus).mockResolvedValue(signedIn);
    fireEvent.click(signIn);

    await waitFor(() =>
      expect(overleafImportTemplate).toHaveBeenCalledWith(
        DEFAULT_OVERLEAF_SERVER,
        LINK,
        "IEEE Conference Template",
        "QUJD",
      ),
    );
    expect(overleafSignIn).toHaveBeenCalledWith(DEFAULT_OVERLEAF_SERVER, expect.any(String));
    expect(onImported).toHaveBeenCalledWith("ieee-abc123", "IEEE Conference Template");
  });

  it("imports a link without a preview when the page has no PDF", async () => {
    vi.mocked(overleafTemplateDetails).mockResolvedValue({ ...DETAILS, hasPdf: false, author: null });
    const { onImported } = renderDialog();

    fireEvent.click(screen.getByTestId("template-import-link"));
    fireEvent.change(screen.getByTestId("template-import-link-input"), { target: { value: LINK } });
    fireEvent.submit(screen.getByTestId("template-import-link-input").closest("form") as HTMLFormElement);

    await screen.findByTestId("template-import-details");
    expect(screen.getByText(copy.noPreview)).toBeInTheDocument();
    expect(overleafTemplatePdf).not.toHaveBeenCalled();
    expect(firstPagePng).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("template-import-link-save"));
    await waitFor(() =>
      expect(overleafImportTemplate).toHaveBeenCalledWith(
        DEFAULT_OVERLEAF_SERVER,
        LINK,
        "IEEE Conference Template",
        null,
      ),
    );
    expect(onImported).toHaveBeenCalledOnce();
  });

  it("shows why a link can't be used and asks to sign in again after an expired sign-in", async () => {
    vi.mocked(overleafTemplateDetails).mockRejectedValueOnce(
      '@oleafly/error:{"code":"overleaf.template_link_invalid"}',
    );
    renderDialog();

    fireEvent.click(screen.getByTestId("template-import-link"));
    fireEvent.change(screen.getByTestId("template-import-link-input"), {
      target: { value: "https://example.com/x" },
    });
    fireEvent.click(screen.getByTestId("template-import-look-up"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/isn't an Overleaf template page/);

    fireEvent.change(screen.getByTestId("template-import-link-input"), { target: { value: LINK } });
    fireEvent.click(screen.getByTestId("template-import-look-up"));
    await screen.findByTestId("template-import-details");
    vi.mocked(overleafImportTemplate).mockRejectedValueOnce(
      '@oleafly/error:{"code":"overleaf.session_expired"}',
    );
    fireEvent.click(screen.getByTestId("template-import-link-save"));

    expect(await screen.findByTestId("template-import-sign-in")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/sign-in expired/);
  });

  it("keeps a cancelled sign-in quiet and does not import", async () => {
    vi.mocked(overleafStatus).mockResolvedValue(signedOut);
    vi.mocked(overleafSignIn).mockRejectedValue('@oleafly/error:{"code":"overleaf.sign_in_cancelled"}');
    renderDialog();

    fireEvent.click(screen.getByTestId("template-import-link"));
    fireEvent.change(screen.getByTestId("template-import-link-input"), { target: { value: LINK } });
    fireEvent.click(screen.getByTestId("template-import-look-up"));
    await screen.findByTestId("template-import-details");
    fireEvent.click(screen.getByTestId("template-import-link-save"));
    fireEvent.click(await screen.findByTestId("template-import-sign-in"));

    await waitFor(() => expect(overleafSignIn).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(overleafImportTemplate).not.toHaveBeenCalled();
  });

  it("saves one of the account's projects, found by search", async () => {
    vi.mocked(overleafListProjects).mockResolvedValue({
      status: signedIn,
      projects: [
        remote("a1", "Lab master"),
        remote("b2", "Grant notes", { owned: false, ownerName: "Grace Hopper" }),
        remote("c3", "Old lab draft", { archived: true }),
      ],
    });
    const { onImported } = renderDialog();

    fireEvent.click(screen.getByTestId("template-import-account"));

    expect(await screen.findByTestId("template-import-account-a1")).toBeInTheDocument();
    expect(screen.getByTestId("template-import-account-b2")).toHaveTextContent("Grace Hopper");
    expect(screen.queryByTestId("template-import-account-c3")).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId("template-import-account-search"), {
      target: { value: "LAB" },
    });
    expect(screen.queryByTestId("template-import-account-b2")).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId("template-import-account-search"), {
      target: { value: "nothing like it" },
    });
    expect(screen.getByText(copy.accountEmpty)).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("template-import-account-search"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByTestId("template-import-account-a1"));

    expect(screen.getByTestId("template-import-name")).toHaveValue("Lab master");
    fireEvent.click(screen.getByTestId("template-import-account-save"));

    await waitFor(() =>
      expect(overleafSaveProjectAsTemplate).toHaveBeenCalledWith(
        DEFAULT_OVERLEAF_SERVER,
        "a1",
        "Lab master",
      ),
    );
    expect(onImported).toHaveBeenCalledWith("lab-master-abc123", "Lab master");
  });

  it("asks to sign in before listing the account, and offers a retry when the list fails", async () => {
    vi.mocked(overleafStatus).mockResolvedValueOnce(signedOut);
    renderDialog();

    fireEvent.click(screen.getByTestId("template-import-account"));
    const signIn = await screen.findByTestId("template-import-account-sign-in");
    vi.mocked(overleafListProjects).mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(signIn);

    await waitFor(() => expect(overleafSignIn).toHaveBeenCalled());
    expect(await screen.findByText(copy.accountFailed)).toBeInTheDocument();
    vi.mocked(overleafListProjects).mockResolvedValueOnce({
      status: signedIn,
      projects: [remote("a1", "Lab master")],
    });
    fireEvent.click(screen.getByRole("button", { name: copy.tryAgain }));
    expect(await screen.findByTestId("template-import-account-a1")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("template-import-account-a1"));
    fireEvent.click(screen.getByTestId("template-import-back"));
    expect(await screen.findByTestId("template-import-account-a1")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("template-import-back"));
    expect(screen.getByTestId("template-import-zip")).toBeInTheDocument();
  });

  it("keeps the step picked right after opening and starts over when reopened", async () => {
    const props = { onClose: vi.fn(), onImported: vi.fn() };
    const view = render(<TemplateImportDialog open {...props} />);
    fireEvent.click(screen.getByTestId("template-import-link"));
    fireEvent.change(screen.getByTestId("template-import-link-input"), { target: { value: LINK } });
    await waitFor(() =>
      expect(screen.getByTestId("template-import-link-input")).toHaveValue(LINK),
    );

    view.rerender(<TemplateImportDialog open={false} {...props} />);
    view.rerender(<TemplateImportDialog open {...props} />);
    expect(await screen.findByTestId("template-import-link")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("template-import-link"));
    expect(screen.getByTestId("template-import-link-input")).toHaveValue("");
  });

  it("does not close while an import is running", async () => {
    let finish: (id: string) => void = () => {};
    vi.mocked(pickOpenPath).mockResolvedValue("/tmp/a.zip");
    vi.mocked(importTemplateFromPath).mockImplementation(
      () => new Promise<string>((resolve) => { finish = resolve; }),
    );
    const { onClose, onImported } = renderDialog();

    fireEvent.click(screen.getByTestId("template-import-zip"));
    fireEvent.click(await screen.findByTestId("template-import-save"));
    await waitFor(() => expect(importTemplateFromPath).toHaveBeenCalled());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    finish("a-1");
    await waitFor(() => expect(onImported).toHaveBeenCalledWith("a-1", "a"));
  });
});
