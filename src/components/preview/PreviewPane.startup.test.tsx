// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import enPreview from "@/i18n/locales/en/preview.json" with { type: "json" };
import enIntelligence from "@/i18n/locales/en/intelligence.json" with { type: "json" };
import type { LanguageServiceReadiness } from "@/lib/analysis/project-snapshot";
import type { AnalysisReasonKey } from "@/lib/analysis/reason";

vi.mock("@/components/pdf/PdfViewer", () => ({
  PdfViewer: () => null,
}));
vi.mock("@/components/editor/LogPane", () => ({
  LogPane: () => null,
}));
vi.mock("@/features/synctex", () => ({
  canUseSyncTexForCheckpoint: vi.fn(() => false),
  inverseFromClick: vi.fn(),
}));
vi.mock("@/features/ask-ai-compile-errors", () => ({
  askAiAboutCompileErrors: vi.fn(),
}));
vi.mock("@/lib/preview-window", () => ({ openPreviewWindow: vi.fn() }));

import {
  checkpointIdentity,
  DocumentStartupProgress,
  documentStartupStages,
  PdfOutlineItems,
  PdfStateMessage,
  previewWindowState,
  trimEdgeCharacter,
  type DocumentStartupStage,
  type DocumentStartupState,
} from "./PreviewPane";

const startup = enPreview.startup;

function stateWith(patch: Partial<DocumentStartupState> = {}): DocumentStartupState {
  return {
    projectActive: true,
    projectLoading: false,
    engineLoaded: true,
    languageReadiness: "ready",
    languageReason: "",
    analysisStatus: "success",
    analysisReason: "",
    analysisReasonKey: null,
    compileStatus: "idle",
    compilePhase: "idle",
    compileCurrent: false,
    compileFailureReason: null,
    hasPdfCandidate: false,
    viewerIdentity: null,
    pdfCurrent: false,
    pdfLoadState: { status: "idle", documentIdentity: "" },
    retainedLoadFailure: null,
    ...patch,
  };
}

const stageById = (state: DocumentStartupState, id: DocumentStartupStage["id"]) => {
  const stage = documentStartupStages(state).find((entry) => entry.id === id);
  if (!stage) throw new Error(`missing stage ${id}`);
  return stage;
};

describe("document startup stages", () => {
  it("skips every stage with no project open", () => {
    const stages = documentStartupStages(stateWith({ projectActive: false }));
    expect(stages.map((stage) => stage.id)).toEqual(["analysis", "compile", "render"]);
    expect(stages[0].detail).toBe(startup.noProject);
    expect(stages[0].status).toBe("skipped");
    expect(stages[1].detail).toBe(startup.noProject);
    expect(stages[1].status).toBe("skipped");
    expect(stages[2].detail).toBe(startup.render.waitingForCompile);
  });

  it("reports the project files opening before anything else", () => {
    const stage = stageById(
      stateWith({ projectLoading: true, analysisStatus: "not_run" }),
      "analysis",
    );
    expect(stage.status).toBe("running");
    expect(stage.detail).toBe(startup.language.openingFiles);
  });

  const readinessCases: readonly [LanguageServiceReadiness, string, string][] = [
    ["starting", startup.language.starting, "running"],
    ["restarting", startup.language.restarting, "running"],
    ["installing", startup.language.installing, "running"],
    ["local_only", startup.language.queued, "pending"],
    ["unsupported", startup.language.notAvailable, "skipped"],
    ["stopped", startup.language.notAvailable, "skipped"],
    ["setup_required", startup.language.notAvailable, "skipped"],
    ["unavailable", startup.language.notAvailable, "skipped"],
  ];

  it.each(readinessCases)(
    "speaks for the pair while the service is %s",
    (languageReadiness, detail, status) => {
      const stage = stageById(
        stateWith({ languageReadiness, analysisStatus: "not_run" }),
        "analysis",
      );
      expect(stage.status).toBe(status);
      expect(stage.detail).toBe(detail);
    },
  );

  it("prefers a supplied service reason over the default text", () => {
    const stage = stageById(
      stateWith({
        languageReadiness: "starting",
        languageReason: enIntelligence.languageService.reasons.starting,
        analysisStatus: "not_run",
      }),
      "analysis",
    );
    expect(stage.detail).toBe(enIntelligence.languageService.reasons.starting);
  });

  it("waits for the service once the analysis half has settled", () => {
    const stage = stageById(
      stateWith({ languageReadiness: "starting", analysisStatus: "success" }),
      "analysis",
    );
    expect(stage.status).toBe("running");
    expect(stage.detail).toBe(startup.language.waitingForService);
  });

  it("shows the service connecting as analysis synchronizing", () => {
    const stage = stageById(
      stateWith({ languageReadiness: "syncing", analysisStatus: "not_run" }),
      "analysis",
    );
    expect(stage.status).toBe("running");
    expect(stage.detail).toBe(startup.language.syncing);
  });

  const analysisCases: readonly [
    DocumentStartupState["analysisStatus"],
    string,
    DocumentStartupStage["status"],
  ][] = [
    ["running", startup.language.analyzing, "running"],
    ["success", startup.language.analyzed, "complete"],
    ["partial", startup.language.partial, "complete"],
    ["error", startup.language.needsAttention, "error"],
    ["unsupported", startup.language.notAvailable, "skipped"],
    ["unavailable", startup.language.notAvailable, "skipped"],
    ["not_run", startup.language.queued, "pending"],
  ];

  it.each(analysisCases)("reports analysis %s", (analysisStatus, detail, status) => {
    const stage = stageById(stateWith({ analysisStatus }), "analysis");
    expect(stage.status).toBe(status);
    expect(stage.detail).toBe(detail);
  });

  it("keeps a rebuilding index running rather than partial", () => {
    const key: AnalysisReasonKey = "indexRebuilding";
    const running = stageById(
      stateWith({
        analysisStatus: "partial",
        analysisReasonKey: key,
        analysisReason: enIntelligence.analysis.reasons.indexRebuilding,
      }),
      "analysis",
    );
    expect(running.status).toBe("running");
    expect(running.detail).toBe(enIntelligence.analysis.reasons.indexRebuilding);

    const settled = stageById(
      stateWith({
        analysisStatus: "partial",
        analysisReasonKey: "diagnosticsPartial",
        analysisReason: enIntelligence.analysis.reasons.diagnosticsPartial,
      }),
      "analysis",
    );
    expect(settled.status).toBe("complete");
    expect(settled.detail).toBe(enIntelligence.analysis.reasons.diagnosticsPartial);
  });

  it("prefers a supplied analysis reason for every unsettled state", () => {
    const reason = enIntelligence.analysis.reasons.diagnosticsPartial;
    for (const analysisStatus of ["running", "partial", "error", "unsupported", "not_run"] as const) {
      const stage = stageById(stateWith({ analysisStatus, analysisReason: reason }), "analysis");
      expect(stage.detail, analysisStatus).toBe(reason);
    }
  });

  it("skips the analysis row when the service cannot run at all", () => {
    for (const languageReadiness of [
      "setup_required",
      "unavailable",
      "unsupported",
      "stopped",
    ] as const) {
      const stage = stageById(
        stateWith({ languageReadiness, analysisStatus: "not_run" }),
        "analysis",
      );
      expect(stage.status, languageReadiness).toBe("skipped");
      expect(stage.detail).toBe(startup.language.notAvailable);
    }
  });

  it("waits for the engine before the service or the compiler start", () => {
    const state = stateWith({
      engineLoaded: false,
      languageReadiness: "not_run",
      analysisStatus: "not_run",
    });
    expect(stageById(state, "analysis").detail).toBe(startup.waitingForEngine);
    expect(stageById(state, "compile").detail).toBe(startup.waitingForEngine);
  });

  const compileCases: readonly [
    Partial<DocumentStartupState>,
    string,
    DocumentStartupStage["status"],
  ][] = [
    [{ compileStatus: "compiling", compilePhase: "saving" }, startup.compile.saving, "running"],
    [
      { compileStatus: "compiling", compilePhase: "downloading" },
      startup.compile.downloading,
      "running",
    ],
    [
      { compileStatus: "compiling", compilePhase: "building" },
      startup.compile.producing,
      "running",
    ],
    [{ compileStatus: "error" }, startup.compile.failed, "error"],
    [{ compileStatus: "unavailable" }, startup.compile.unavailable, "error"],
    [{ compileCurrent: true }, startup.compile.accepted, "complete"],
    [{}, startup.compile.waiting, "pending"],
  ];

  it.each(compileCases)("reports the compile stage for %j", (patch, detail, status) => {
    const stage = stageById(stateWith(patch), "compile");
    expect(stage.label).toBe(startup.compile.label);
    expect(stage.status).toBe(status);
    expect(stage.detail).toBe(detail);
  });

  it("prefers the failure reason the compiler reported", () => {
    const stage = stageById(
      stateWith({ compileStatus: "error", compileFailureReason: "latexmk exited 1" }),
      "compile",
    );
    expect(stage.detail).toBe("latexmk exited 1");
  });

  it("reports the render stage while the viewer reads the document", () => {
    const loading = stageById(
      stateWith({
        viewerIdentity: "doc-1",
        pdfLoadState: { status: "loading", documentIdentity: "doc-1" },
      }),
      "render",
    );
    expect(loading.status).toBe("running");
    expect(loading.detail).toBe(startup.render.preparing);

    const reading = stageById(
      stateWith({
        viewerIdentity: "doc-1",
        pdfLoadState: { status: "loading", documentIdentity: "doc-1", progress: 0.42 },
      }),
      "render",
    );
    expect(reading.detail).toBe(startup.render.reading.replace("{{percent}}", "42"));
  });

  it("reports every render failure the viewer can report", () => {
    for (const status of ["empty", "invalid", "unavailable", "error"] as const) {
      const stage = stageById(
        stateWith({
          viewerIdentity: "doc-1",
          pdfLoadState: { status, documentIdentity: "doc-1" },
        }),
        "render",
      );
      expect(stage.status, status).toBe("error");
      expect(stage.detail).toBe(startup.render.needsAttention);
    }
    const locked = stageById(
      stateWith({
        viewerIdentity: "doc-1",
        pdfLoadState: { status: "password_required", documentIdentity: "doc-1" },
      }),
      "render",
    );
    expect(locked.detail).toBe(startup.render.passwordRequired);

    const withMessage = stageById(
      stateWith({
        viewerIdentity: "doc-1",
        pdfLoadState: { status: "error", documentIdentity: "doc-1", message: "broken" },
      }),
      "render",
    );
    expect(withMessage.detail).toBe("broken");

    const retained = stageById(stateWith({ retainedLoadFailure: "stale bytes" }), "render");
    expect(retained.status).toBe("error");
    expect(retained.detail).toBe("stale bytes");
  });

  it("reports the render stage once the viewer is ready", () => {
    const stage = stageById(
      stateWith({
        pdfCurrent: true,
        viewerIdentity: "doc-1",
        pdfLoadState: { status: "ready", documentIdentity: "doc-1" },
      }),
      "render",
    );
    expect(stage.status).toBe("complete");
    expect(stage.detail).toBe(startup.render.ready);
  });

  it("waits for the renderer once verified bytes exist", () => {
    const stage = stageById(
      stateWith({ compileStatus: "success", hasPdfCandidate: true }),
      "render",
    );
    expect(stage.status).toBe("running");
    expect(stage.detail).toBe(startup.render.waitingForRenderer);
  });
});

describe("checkpoint identity", () => {
  const checkpoint = {
    version: 1 as const,
    projectId: "p1",
    mainDocument: "main.tex",
    projectRevision: 4,
    requestGeneration: 2,
    outputKind: "standard" as const,
    producerId: "test",
    outputRevision: 7,
    outputId: "pdf-v1:3:abc",
    completedAt: 11,
  };

  it("marks bytes with no checkpoint as unverified", () => {
    const identity = JSON.parse(checkpointIdentity(null, new Uint8Array([1, 2, 3])));
    expect(identity.projectId).toBe("unverified");
    expect(identity.byteLength).toBe(3);
    expect(identity.projectRevision).toBe(-1);
  });

  it("derives a stable identity from the checkpoint", () => {
    const first = checkpointIdentity(checkpoint, new Uint8Array([1]));
    const second = checkpointIdentity(checkpoint, new Uint8Array([1, 2]));
    expect(first).toBe(second);
    expect(JSON.parse(first).outputId).toBe("pdf-v1:3:abc");
    expect(checkpointIdentity({ ...checkpoint, outputRevision: 8 }, new Uint8Array())).not.toBe(
      first,
    );
  });
});

describe("preview window state", () => {
  const identity = {
    projectId: "p1",
    mainDocument: "main.tex",
    projectRevision: 4,
    requestGeneration: 2,
  };
  const checkpoint = {
    version: 1 as const,
    ...identity,
    outputKind: "standard" as const,
    producerId: "test",
    outputRevision: 7,
    outputId: "pdf-v1:3:abc",
    completedAt: 11,
  };

  it("has nothing to hand over without an identity or a checkpoint", () => {
    expect(previewWindowState("idle", null, null, null)).toBeUndefined();
  });

  it("falls back to the checkpoint identity and renames idle as not run", () => {
    const state = previewWindowState("idle", null, checkpoint, null);
    expect(state?.identity).toEqual(identity);
    expect(state?.status).toBe("not_run");
    expect(state?.checkpoint).toBeNull();
  });

  it("passes the checkpoint through only on an exact success match", () => {
    const matched = previewWindowState("success", identity, checkpoint, null);
    expect(matched?.checkpoint).toBe(checkpoint);
    const mismatched = previewWindowState(
      "success",
      { ...identity, projectRevision: 5 },
      checkpoint,
      null,
    );
    expect(mismatched?.checkpoint).toBeNull();
  });

  it("carries a message when there is one", () => {
    expect(previewWindowState("error", identity, null, "boom")).toMatchObject({
      status: "error",
      message: "boom",
    });
    expect(previewWindowState("error", identity, null, null)).not.toHaveProperty("message");
  });
});

describe("DocumentStartupProgress", () => {
  const stages: DocumentStartupStage[] = [
    {
      id: "analysis",
      label: startup.language.analysisLabel,
      detail: startup.language.analyzing,
      status: "running",
    },
    {
      id: "compile",
      label: startup.compile.label,
      detail: startup.compile.waiting,
      status: "pending",
    },
    {
      id: "render",
      label: startup.render.label,
      detail: startup.render.needsAttention,
      status: "error",
    },
  ];

  it("names the running stage and counts the rest", () => {
    render(<DocumentStartupProgress stages={stages} />);
    expect(
      screen.getByRole("status", {
        name: startup.progressLabel
          .replace("{{completed}}", "0")
          .replace("{{total}}", "3"),
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: startup.language.analysisLabel }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `${startup.metaRunning.replace("{{stages}}", "1")} · ${startup.metaQueued.replace("{{stages}}", "1")} · ${startup.metaFailed.replace("{{stages}}", "1")}`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(startup.status.running)).toBeInTheDocument();
    expect(screen.getByText(startup.status.queued)).toBeInTheDocument();
    expect(screen.getByText(startup.status.failed)).toBeInTheDocument();
  });

  it("reads as attention needed when nothing is running", () => {
    const failed = stages.map((stage) =>
      stage.status === "running" ? { ...stage, status: "skipped" as const } : stage,
    );
    render(<DocumentStartupProgress stages={failed} />);
    expect(
      screen.getByRole("heading", { name: startup.headingAttention }),
    ).toBeInTheDocument();
    expect(screen.getByText(startup.status.skipped)).toBeInTheDocument();
  });

  it("reads as ready once every stage has settled", () => {
    const done = stages.map((stage) => ({ ...stage, status: "complete" as const }));
    render(<DocumentStartupProgress stages={done} />);
    expect(screen.getByRole("heading", { name: startup.headingReady })).toBeInTheDocument();
    expect(
      screen.getByText(
        startup.doneCount.replace("{{completed}}", "3").replace("{{total}}", "3"),
      ),
    ).toBeInTheDocument();
  });

  it("reads as preparing while a stage is queued", () => {
    const queued: DocumentStartupStage[] = [
      { ...stages[1] },
      { ...stages[0], status: "complete" },
    ];
    render(<DocumentStartupProgress stages={queued} />);
    expect(
      screen.getByRole("heading", { name: startup.headingPreparing }),
    ).toBeInTheDocument();
  });

  it("repeats the current detail in the compact layout", () => {
    render(<DocumentStartupProgress stages={stages} compact />);
    expect(screen.getByTitle(startup.language.analyzing)).toBeInTheDocument();
  });

  it("offers a compile button when the caller supplies one", async () => {
    const onCompile = vi.fn();
    render(<DocumentStartupProgress stages={stages} onCompile={onCompile} />);
    await userEvent.click(screen.getByRole("button", { name: startup.compileNow }));
    expect(onCompile).toHaveBeenCalledTimes(1);
  });
});

describe("PdfStateMessage", () => {
  const loadingTitle = enPreview.window.loadingTitle;
  const invalidTitle = enPreview.viewer.invalidTitle;
  const detail = enPreview.viewer.loadFailedDetail;

  it("announces a loading state politely", () => {
    render(
      <PdfStateMessage kind="loading" title={loadingTitle} detail={detail} />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("heading", { name: loadingTitle })).toBeInTheDocument();
    expect(screen.getByText(detail)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: enPreview.viewer.retry }),
    ).not.toBeInTheDocument();
  });

  it("announces an error assertively and offers a retry", async () => {
    const onRetry = vi.fn();
    render(
      <PdfStateMessage
        kind="error"
        title={invalidTitle}
        detail={detail}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
    await userEvent.click(screen.getByRole("button", { name: enPreview.viewer.retry }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("PdfOutlineItems", () => {
  it("renders nested entries and activates the one the reader picks", async () => {
    const onActivate = vi.fn();
    render(
      <PdfOutlineItems
        onActivate={onActivate}
        items={[
          {
            id: "a",
            title: "Introduction",
            external: false,
            children: [
              { id: "a1", title: "Background", external: true, children: [] },
              {
                id: "a2",
                title: "Blocked",
                external: false,
                children: [],
                disabledReason: "No destination",
              },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByLabelText(enPreview.outline.externalLink)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Blocked" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Introduction" }));
    expect(onActivate).toHaveBeenCalledWith("a");
  });
});

describe("trimEdgeCharacter", () => {
  it("strips the character from both ends only", () => {
    expect(trimEdgeCharacter("__a_b__", "_")).toBe("a_b");
    expect(trimEdgeCharacter("--paper--", "-")).toBe("paper");
    expect(trimEdgeCharacter("paper", "-")).toBe("paper");
    expect(trimEdgeCharacter("", "-")).toBe("");
    expect(trimEdgeCharacter("____", "_")).toBe("");
  });

  it("stays linear on long runs", () => {
    const started = Date.now();
    expect(trimEdgeCharacter("_".repeat(200000), "_")).toBe("");
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
