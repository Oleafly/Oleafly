import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getLanguageServiceRuntimeProfile,
  LanguageServiceClient,
  type LanguageServiceInstallResult,
  type LanguageServiceInstallStatus,
  type LanguageServiceKind,
} from "@/lib/language-service";
import { createProjectAnalysisStore } from "@/store/project-analysis";
import {
  LanguageServiceController,
  type LanguageServiceProjectSnapshot,
} from "./language-service-controller";
import { FakeTinymistTransport } from "./fake-tinymist-transport";
import {
  DEFAULT_TYPST_LANGUAGE_SERVICE_SETTINGS,
  type LanguageServiceSettingsSource,
  type TypstLanguageServiceSettings,
} from "./tinymist-configuration";
import { tinymistOptionsForVersion } from "./tinymist-compat";

const BUNDLED_TINYMIST = getLanguageServiceRuntimeProfile("tinymist").version;
const PROJECT = "project-typst";

const TINYMIST_FOR_TYPST: Readonly<Record<string, string>> = {
  "0.11": "0.11.32",
  "0.12": "0.12.22",
  "0.13": "0.13.30",
  "0.14": "0.14.20",
  "0.15": BUNDLED_TINYMIST,
};

function typstLine(version: string): string {
  return version.split(".").slice(0, 2).join(".");
}

function typstSnapshot(
  typstVersion: string,
  overrides: Partial<LanguageServiceProjectSnapshot> = {},
): LanguageServiceProjectSnapshot {
  const files = {
    "main.typ": { content: "= Paper\n" },
  };
  return {
    projectId: PROJECT,
    engineId: "typst",
    engineLoaded: true,
    mainDoc: "main.typ",
    tree: [{ path: "main.typ", is_dir: false }],
    files,
    indexTexts: {},
    index: null,
    typstVersion,
    ...overrides,
  };
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

function deferred(): Deferred {
  let resolve = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  promise.catch(() => {});
  return { promise, resolve, reject };
}

function settingsSource() {
  let current: TypstLanguageServiceSettings = {
    ...DEFAULT_TYPST_LANGUAGE_SERVICE_SETTINGS,
  };
  const listeners = new Set<() => void>();
  const source: LanguageServiceSettingsSource = {
    get: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    source,
    set(next: Partial<TypstLanguageServiceSettings>) {
      current = { ...current, ...next };
      for (const listener of listeners) listener();
    },
  };
}

const controllers: LanguageServiceController[] = [];

function harness(initialTypst: string, installed: string[] = []) {
  const transport = new FakeTinymistTransport();
  const store = createProjectAnalysisStore();
  const settings = settingsSource();
  const downloaded = new Set<string>([BUNDLED_TINYMIST, ...installed]);
  let typst = initialTypst;
  let nextDownload: Deferred | null = null;
  const matched = () => TINYMIST_FOR_TYPST[typstLine(typst)] ?? BUNDLED_TINYMIST;
  const installStatus = vi.fn(
    async (
      kind: LanguageServiceKind,
      _projectId?: string,
    ): Promise<LanguageServiceInstallStatus> => {
      const version = kind === "tinymist" ? matched() : getLanguageServiceRuntimeProfile(kind).version;
      return {
        kind,
        version,
        state: downloaded.has(version) ? "installed" : "missing",
      };
    },
  );
  const install = vi.fn(
    async (
      kind: LanguageServiceKind,
      _projectId?: string,
    ): Promise<LanguageServiceInstallResult> => {
      const version = matched();
      const gate = nextDownload;
      nextDownload = null;
      if (gate) await gate.promise;
      downloaded.add(version);
      return { kind, version, state: "installed" };
    },
  );
  const controller = new LanguageServiceController({
    store,
    isAvailable: () => true,
    provisioner: { installStatus, install },
    createClient: (clientKind, projectId) =>
      new LanguageServiceClient({
        transport,
        kind: clientKind,
        projectId,
      }),
    settings: settings.source,
  });
  controllers.push(controller);
  return {
    controller,
    transport,
    store,
    settings,
    installStatus,
    install,
    pin(version: string) {
      typst = version;
    },
    markInstalled(version: string) {
      downloaded.add(version);
    },
    holdNextDownload(): Deferred {
      const gate = deferred();
      nextDownload = gate;
      return gate;
    },
  };
}

function initializationOptions(
  transport: FakeTinymistTransport,
  index = 0,
): unknown {
  const params = transport.methods("initialize")[index]?.params as
    | { initializationOptions: unknown }
    | undefined;
  return params?.initializationOptions;
}

afterEach(async () => {
  for (const controller of controllers.splice(0)) {
    await controller.dispose();
  }
});

describe("Tinymist matched to the project's Typst version", () => {
  it("starts the bundled Tinymist without a download when the Typst minor matches it", async () => {
    const { controller, transport, store, installStatus, install } =
      harness("0.15.1");
    controller.update(typstSnapshot("0.15.1"));
    await controller.whenIdle();

    expect(installStatus).toHaveBeenCalledWith("tinymist", PROJECT);
    expect(install).not.toHaveBeenCalled();
    expect(transport.methods("initialize")).toHaveLength(1);
    expect(initializationOptions(transport)).toMatchObject({
      formatterIndentSize: 2,
      lint: { enabled: false, when: "onSave" },
    });
    expect(store.getState().snapshot.languageService.readiness).toBe("ready");
  });

  it("downloads the matching Tinymist on first need while the editor keeps working", async () => {
    const { controller, transport, store, install, holdNextDownload } =
      harness("0.13.1");
    const download = holdNextDownload();
    controller.update(typstSnapshot("0.13.1"));
    await controller.whenIdle();

    expect(install).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledWith("tinymist", PROJECT);
    const waiting = store.getState().snapshot.languageService;
    expect(waiting.readiness).toBe("installing");
    expect(waiting.reason).toEqual({
      key: "tinymistDownloading",
      params: { version: "0.13.30" },
    });
    expect(transport.methods("initialize")).toHaveLength(0);

    controller.update(
      typstSnapshot("0.13.1", {
        files: { "main.typ": { content: "= Paper\n\nMore\n" } },
      }),
    );
    await controller.whenIdle();
    expect(install).toHaveBeenCalledTimes(1);
    expect(store.getState().snapshot.languageService.readiness).toBe(
      "installing",
    );

    download.resolve();
    await vi.waitFor(() => {
      expect(store.getState().snapshot.languageService.readiness).toBe(
        "ready",
      );
    });
    expect(transport.methods("initialize")).toHaveLength(1);
    expect(initializationOptions(transport)).toMatchObject({
      lint: { enabled: false, when: "onSave" },
    });
  });

  it("explains a failed download and downloads again only when retried", async () => {
    const { controller, store, install, holdNextDownload } =
      harness("0.12.0");
    const failed = holdNextDownload();
    controller.update(typstSnapshot("0.12.0"));
    await controller.whenIdle();
    failed.reject(
      Object.assign(new Error("offline"), { code: "download_failed" }),
    );

    await vi.waitFor(() => {
      expect(store.getState().snapshot.languageService.readiness).toBe(
        "unavailable",
      );
    });
    const service = store.getState().snapshot.languageService;
    expect(service.reason).toEqual({
      key: "tinymistDownloadFailed",
      params: { version: "0.12.22" },
    });
    expect(service.failure?.retryable).toBe(true);

    controller.update(
      typstSnapshot("0.12.0", {
        files: { "main.typ": { content: "= Paper\n\nEdited\n" } },
      }),
    );
    await controller.whenIdle();
    expect(install).toHaveBeenCalledTimes(1);
    expect(store.getState().snapshot.languageService.readiness).toBe(
      "unavailable",
    );

    controller.retry();
    await vi.waitFor(() => {
      expect(store.getState().snapshot.languageService.readiness).toBe(
        "ready",
      );
    });
    expect(install).toHaveBeenCalledTimes(2);
  });

  it("starts once the matching build is present after a failed download, without a retry", async () => {
    const { controller, store, install, holdNextDownload, markInstalled } =
      harness("0.12.0");
    const failed = holdNextDownload();
    controller.update(typstSnapshot("0.12.0"));
    await controller.whenIdle();
    failed.reject(new Error("offline"));
    await vi.waitFor(() => {
      expect(store.getState().snapshot.languageService.readiness).toBe(
        "unavailable",
      );
    });

    markInstalled("0.12.22");
    controller.update(
      typstSnapshot("0.12.0", {
        files: { "main.typ": { content: "= Paper\n\nEdited\n" } },
      }),
    );
    await vi.waitFor(() => {
      expect(store.getState().snapshot.languageService.readiness).toBe(
        "ready",
      );
    });
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("downloads again when setup reports an installation in progress after a failure", async () => {
    const { controller, store, install, installStatus, holdNextDownload } =
      harness("0.12.0");
    const failed = holdNextDownload();
    controller.update(typstSnapshot("0.12.0"));
    await controller.whenIdle();
    failed.reject(new Error("offline"));
    await vi.waitFor(() => {
      expect(store.getState().snapshot.languageService.readiness).toBe(
        "unavailable",
      );
    });

    installStatus.mockResolvedValueOnce({
      kind: "tinymist",
      version: "0.12.22",
      state: "installing",
    });
    controller.update(
      typstSnapshot("0.12.0", {
        files: { "main.typ": { content: "= Paper\n\nEdited\n" } },
      }),
    );
    await vi.waitFor(() => {
      expect(store.getState().snapshot.languageService.readiness).toBe(
        "ready",
      );
    });
    expect(install).toHaveBeenCalledTimes(2);
  });

  it("ignores a download that finishes after another project opened", async () => {
    const { controller, store, installStatus, holdNextDownload, pin } =
      harness("0.13.1");
    const first = holdNextDownload();
    controller.update(typstSnapshot("0.13.1"));
    await controller.whenIdle();
    expect(store.getState().snapshot.languageService.readiness).toBe(
      "installing",
    );

    const second = holdNextDownload();
    pin("0.14.1");
    controller.update(typstSnapshot("0.14.1", { projectId: "project-other" }));
    await controller.whenIdle();
    expect(store.getState().snapshot.languageService.reason).toEqual({
      key: "tinymistDownloading",
      params: { version: "0.14.20" },
    });
    const checks = installStatus.mock.calls.length;

    first.resolve();
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
    await controller.whenIdle();
    expect(installStatus.mock.calls.length).toBe(checks);
    expect(store.getState().snapshot.languageService.readiness).toBe(
      "installing",
    );

    second.resolve();
    await vi.waitFor(() => {
      expect(store.getState().snapshot.languageService.readiness).toBe(
        "ready",
      );
    });
    expect(installStatus).toHaveBeenLastCalledWith("tinymist", "project-other");
    expect(store.getState().snapshot.identity.projectId).toBe("project-other");
  });

  it("keeps only the startup options each older Tinymist reads", async () => {
    const eleven = harness("0.11.1", ["0.11.32"]);
    eleven.controller.update(typstSnapshot("0.11.1"));
    await eleven.controller.whenIdle();
    expect(initializationOptions(eleven.transport)).toEqual({
      exportPdf: "never",
      compileStatus: "disable",
      formatterMode: "typstyle",
      formatterPrintWidth: 120,
    });

    const twelve = harness("0.12.0", ["0.12.22"]);
    twelve.controller.update(typstSnapshot("0.12.0"));
    await twelve.controller.whenIdle();
    expect(initializationOptions(twelve.transport)).toEqual({
      exportPdf: "never",
      compileStatus: "disable",
      formatterMode: "typstyle",
      formatterPrintWidth: 120,
      formatterIndentSize: 2,
    });

    twelve.settings.set({ formatterPrintWidth: 80 });
    await vi.waitFor(() => {
      expect(
        twelve.transport.methods("workspace/didChangeConfiguration"),
      ).toHaveLength(1);
    });
    expect(
      twelve.transport.methods("workspace/didChangeConfiguration")[0]?.params,
    ).toEqual({
      settings: {
        exportPdf: "never",
        compileStatus: "disable",
        formatterMode: "typstyle",
        formatterPrintWidth: 80,
        formatterIndentSize: 2,
      },
    });
  });

  it("restarts Tinymist with the matching build when the pin moves to another minor", async () => {
    const { controller, transport, installStatus, pin } = harness(
      "0.15.1",
      ["0.13.30"],
    );
    controller.update(typstSnapshot("0.15.1"));
    await controller.whenIdle();
    expect(transport.methods("initialize")).toHaveLength(1);

    pin("0.15.0");
    controller.update(typstSnapshot("0.15.0"));
    await controller.whenIdle();
    expect(transport.methods("initialize")).toHaveLength(1);
    expect(transport.methods("shutdown")).toHaveLength(0);

    pin("0.13.1");
    controller.update(typstSnapshot("0.13.1"));
    await controller.whenIdle();
    await vi.waitFor(() => {
      expect(transport.methods("initialize")).toHaveLength(2);
    });
    expect(transport.methods("shutdown")).toHaveLength(1);
    expect(await installStatus.mock.results.at(-1)?.value).toMatchObject({
      version: "0.13.30",
      state: "installed",
    });
  });

  it("restarts Tinymist when the project starts or stops using its vendored packages", async () => {
    const { controller, transport } = harness("0.15.1");
    controller.update(typstSnapshot("0.15.1"));
    await controller.whenIdle();
    expect(transport.methods("initialize")).toHaveLength(1);

    controller.update(typstSnapshot("0.15.1", { typstVendorPackages: false }));
    await controller.whenIdle();
    expect(transport.methods("initialize")).toHaveLength(1);
    expect(transport.methods("shutdown")).toHaveLength(0);

    controller.update(typstSnapshot("0.15.1", { typstVendorPackages: true }));
    await controller.whenIdle();
    await vi.waitFor(() => {
      expect(transport.methods("initialize")).toHaveLength(2);
    });
    expect(transport.methods("shutdown")).toHaveLength(1);

    controller.update(
      typstSnapshot("0.15.1", {
        typstVendorPackages: true,
        files: { "main.typ": { content: "= Paper\n\nVendored\n" } },
      }),
    );
    await controller.whenIdle();
    expect(transport.methods("initialize")).toHaveLength(2);

    controller.update(typstSnapshot("0.15.1"));
    await controller.whenIdle();
    await vi.waitFor(() => {
      expect(transport.methods("initialize")).toHaveLength(3);
    });
    expect(transport.methods("shutdown")).toHaveLength(2);
  });
});

describe("Tinymist options per version", () => {
  const options = {
    exportPdf: "never",
    compileStatus: "disable",
    formatterMode: "typstyle",
    formatterPrintWidth: 100,
    formatterIndentSize: 4,
    lint: { enabled: true, when: "onSave" },
  };

  it("drops options a release line does not read", () => {
    expect(tinymistOptionsForVersion(options, "0.11.32")).toEqual({
      exportPdf: "never",
      compileStatus: "disable",
      formatterMode: "typstyle",
      formatterPrintWidth: 100,
    });
    expect(tinymistOptionsForVersion(options, "0.12.22")).toEqual({
      exportPdf: "never",
      compileStatus: "disable",
      formatterMode: "typstyle",
      formatterPrintWidth: 100,
      formatterIndentSize: 4,
    });
  });

  it("keeps every option for current and unknown releases", () => {
    expect(tinymistOptionsForVersion(options, "0.13.30")).toEqual(options);
    expect(tinymistOptionsForVersion(options, BUNDLED_TINYMIST)).toEqual(
      options,
    );
    expect(tinymistOptionsForVersion(options, "1.0.0")).toEqual(options);
    expect(tinymistOptionsForVersion(null, "0.11.32")).toBeNull();
  });
});
