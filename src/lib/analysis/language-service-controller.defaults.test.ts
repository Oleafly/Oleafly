import { afterEach, describe, expect, it, vi } from "vitest";
import { buildIndex } from "@/lib/index/build";
import { getLanguageServiceRuntimeProfile } from "@/lib/language-service/runtime-profile";
import {
  createProjectAnalysisStore,
  useProjectAnalysisStore,
} from "@/store/project-analysis";
import {
  LanguageServiceController,
  type LanguageServiceProjectSnapshot,
} from "./language-service-controller";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauri.invoke,
  isTauri: tauri.isTauri,
  Channel: class {
    onmessage: (message: unknown) => void;

    constructor(onmessage: (message: unknown) => void) {
      this.onmessage = onmessage;
    }
  },
}));

vi.mock("@/lib/language-service/runtime-profile", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/language-service/runtime-profile")
    >();
  return {
    ...actual,
    getLanguageServiceRuntimeProfile: vi.fn(
      actual.getLanguageServiceRuntimeProfile,
    ),
  };
});

function snapshot(): LanguageServiceProjectSnapshot {
  const files = {
    "main.tex": { content: "\\section{Intro}" },
  };
  return {
    projectId: "project-a",
    engineId: "latex",
    engineLoaded: true,
    mainDoc: "main.tex",
    tree: [{ path: "main.tex", is_dir: false }],
    files,
    indexTexts: {},
    index: buildIndex({ "main.tex": files["main.tex"].content }),
  };
}

const controllers: LanguageServiceController[] = [];

afterEach(async () => {
  for (const controller of controllers.splice(0)) {
    await controller.dispose().catch(() => {});
  }
  tauri.invoke.mockReset();
  tauri.isTauri.mockReset();
  tauri.isTauri.mockReturnValue(true);
  useProjectAnalysisStore.getState().reset();
});

describe("LanguageServiceController default wiring", () => {
  it("checks and installs the server through the native language-service commands", async () => {
    const version = getLanguageServiceRuntimeProfile("texlab").version;
    let installed = false;
    tauri.invoke.mockImplementation(async (command: string) => {
      if (command === "language_service_install_status") {
        return {
          kind: "texlab",
          version,
          state: installed ? "installed" : "missing",
        };
      }
      if (command === "language_service_install") {
        installed = true;
        return { kind: "texlab", version, state: "installed" };
      }
      if (command === "language_service_start") {
        throw {
          code: "sidecar_unavailable",
          message: "texlab could not launch",
        };
      }
      throw new Error(`unexpected ${command}`);
    });
    const controller = new LanguageServiceController();
    controllers.push(controller);

    controller.update(snapshot());
    await controller.whenIdle();
    expect(tauri.invoke).toHaveBeenCalledWith(
      "language_service_install_status",
      { request: { kind: "texlab" } },
    );
    expect(
      useProjectAnalysisStore.getState().snapshot.languageService,
    ).toMatchObject({
      kind: "texlab",
      readiness: "setup_required",
    });

    await controller.setup();
    expect(tauri.invoke).toHaveBeenCalledWith("language_service_install", {
      request: { kind: "texlab" },
    });
    expect(tauri.invoke).toHaveBeenCalledWith(
      "language_service_start",
      expect.objectContaining({
        request: { projectId: "project-a", kind: "texlab" },
      }),
    );
    expect(
      useProjectAnalysisStore.getState().snapshot.languageService,
    ).toMatchObject({
      readiness: "unavailable",
      reason: { key: "startFailed" },
      failure: { code: "sidecar_unavailable", reason: { key: "sidecarUnavailable" } },
    });
  });

  it("degrades to local analysis outside the desktop shell", async () => {
    tauri.isTauri.mockReturnValue(false);
    const controller = new LanguageServiceController();
    controllers.push(controller);

    controller.update(snapshot());
    await controller.whenIdle();

    expect(tauri.invoke).not.toHaveBeenCalled();
    expect(
      useProjectAnalysisStore.getState().snapshot.languageService,
    ).toMatchObject({
      readiness: "unavailable",
      reason: { key: "ipcUnavailable" },
      failure: { retryable: false },
    });
  });
});

describe("LanguageServiceController runtime profile", () => {
  it("reports a broken packaged runtime profile as unavailable without retry", async () => {
    vi.mocked(getLanguageServiceRuntimeProfile).mockImplementationOnce(() => {
      throw new Error("Language-server profile for texlab is invalid");
    });
    const store = createProjectAnalysisStore();
    const installStatus = vi.fn();
    const createClient = vi.fn();
    const controller = new LanguageServiceController({
      store,
      isAvailable: () => true,
      provisioner: { installStatus, install: vi.fn() },
      createClient,
    });
    controllers.push(controller);

    controller.update(snapshot());
    await controller.whenIdle();

    expect(installStatus).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
    expect(store.getState().snapshot.languageService).toMatchObject({
      readiness: "unavailable",
      reason: { key: "runtimeProfileInvalid" },
      failure: {
        message: "Language-server profile for texlab is invalid",
        retryable: false,
      },
    });
    expect(store.getState().snapshot.features.hover).toMatchObject({
      status: "unavailable",
      retryable: false,
    });
  });
});
