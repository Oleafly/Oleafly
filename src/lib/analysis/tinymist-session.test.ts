import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getLanguageServiceRuntimeProfile,
  LanguageServiceClient,
} from "@/lib/language-service";
import { createProjectAnalysisStore } from "@/store/project-analysis";
import {
  LanguageServiceController,
  type LanguageServiceProjectSnapshot,
} from "./language-service-controller";
import { FakeTinymistTransport } from "./fake-tinymist-transport";
import {
  absoluteProjectPath,
  DEFAULT_TYPST_LANGUAGE_SERVICE_SETTINGS,
  type LanguageServiceSettingsSource,
  type TypstLanguageServiceSettings,
} from "./tinymist-configuration";

function settingsSource(initial = DEFAULT_TYPST_LANGUAGE_SERVICE_SETTINGS) {
  let current: TypstLanguageServiceSettings = { ...initial };
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
    listenerCount: () => listeners.size,
  };
}

function typstSnapshot(
  overrides: Partial<LanguageServiceProjectSnapshot> = {},
): LanguageServiceProjectSnapshot {
  const files = {
    "main.typ": { content: "#include \"chapter.typ\"\n" },
    "chapter.typ": { content: "= Chapter\n" },
  };
  return {
    projectId: "project-typst",
    engineId: "typst",
    engineLoaded: true,
    mainDoc: "main.typ",
    tree: Object.keys(files).map((path) => ({ path, is_dir: false })),
    files,
    indexTexts: {},
    index: null,
    ...overrides,
  };
}

const controllers: LanguageServiceController[] = [];

function harness(initial = DEFAULT_TYPST_LANGUAGE_SERVICE_SETTINGS) {
  const transport = new FakeTinymistTransport();
  const settings = settingsSource(initial);
  const controller = new LanguageServiceController({
    store: createProjectAnalysisStore(),
    isAvailable: () => true,
    provisioner: {
      installStatus: async (serverKind) => ({
        kind: serverKind,
        version: getLanguageServiceRuntimeProfile(serverKind).version,
        state: "installed",
      }),
      install: async (serverKind) => ({
        kind: serverKind,
        version: getLanguageServiceRuntimeProfile(serverKind).version,
        state: "already_installed",
      }),
    },
    createClient: (clientKind, projectId) =>
      new LanguageServiceClient({
        transport,
        kind: clientKind,
        projectId,
      }),
    settings: settings.source,
  });
  controllers.push(controller);
  return { controller, transport, settings };
}

afterEach(async () => {
  for (const controller of controllers.splice(0)) {
    await controller.dispose();
  }
});

describe("Tinymist main document", () => {
  it("pins the project's main document once the documents are open", async () => {
    const { controller, transport } = harness();
    controller.update(typstSnapshot());
    await controller.whenIdle();

    await vi.waitFor(() => {
      expect(transport.methods("workspace/executeCommand")).toHaveLength(1);
    });
    const [pin] = transport.methods("workspace/executeCommand");
    expect(pin.params).toEqual({
      command: "tinymist.pinMain",
      arguments: ["/project/main.typ"],
    });
    const order = transport.messages.map((message) => message.method);
    expect(order.lastIndexOf("textDocument/didOpen")).toBeLessThan(
      order.indexOf("workspace/executeCommand"),
    );
  });

  it("re-pins when the main document changes and not on ordinary edits", async () => {
    const { controller, transport } = harness();
    controller.update(typstSnapshot());
    await controller.whenIdle();
    await vi.waitFor(() => {
      expect(transport.methods("workspace/executeCommand")).toHaveLength(1);
    });

    controller.update(
      typstSnapshot({
        files: {
          "main.typ": { content: "#include \"chapter.typ\"\nMore\n" },
          "chapter.typ": { content: "= Chapter\n" },
        },
      }),
    );
    await controller.whenIdle();
    controller.update(typstSnapshot({ mainDoc: "chapter.typ" }));
    await controller.whenIdle();

    await vi.waitFor(() => {
      expect(transport.methods("workspace/executeCommand")).toHaveLength(2);
    });
    expect(transport.methods("workspace/executeCommand")[1]?.params).toEqual({
      command: "tinymist.pinMain",
      arguments: ["/project/chapter.typ"],
    });
  });

  it("unpins when the main document is no longer a Typst file", async () => {
    const { controller, transport } = harness();
    controller.update(typstSnapshot());
    await controller.whenIdle();
    controller.update(typstSnapshot({ mainDoc: "" }));
    await controller.whenIdle();
    await vi.waitFor(() => {
      expect(transport.methods("workspace/executeCommand")).toHaveLength(2);
    });
    expect(transport.methods("workspace/executeCommand")[1]?.params).toEqual({
      command: "tinymist.pinMain",
      arguments: [null],
    });
  });

  it("does not pin when the server lacks the command", async () => {
    const { controller, transport } = harness();
    transport.capabilities = {
      ...transport.capabilities,
      executeCommandProvider: { commands: [] },
    };
    controller.update(typstSnapshot());
    await controller.whenIdle();
    expect(transport.methods("workspace/executeCommand")).toHaveLength(0);
  });

  it("builds platform paths for the pinned file", () => {
    expect(absoluteProjectPath("/a/b/", "src/main.typ")).toBe(
      "/a/b/src/main.typ",
    );
    expect(absoluteProjectPath("C:\\Papers", "src/main.typ")).toBe(
      "C:\\Papers\\src\\main.typ",
    );
  });
});

describe("Tinymist configuration", () => {
  it("starts Tinymist with the packaged profile plus the editor settings", async () => {
    const { controller, transport } = harness();
    controller.update(typstSnapshot());
    await controller.whenIdle();
    const [initialize] = transport.methods("initialize");
    expect(
      (initialize.params as { initializationOptions: unknown })
        .initializationOptions,
    ).toEqual({
      exportPdf: "never",
      compileStatus: "disable",
      formatterMode: "typstyle",
      formatterPrintWidth: 120,
      formatterIndentSize: 2,
      lint: { enabled: false, when: "onSave" },
    });
  });

  it("sends formatter changes to the running server without a restart", async () => {
    const { controller, transport, settings } = harness();
    controller.update(typstSnapshot());
    await controller.whenIdle();

    settings.set({ formatterPrintWidth: 80, formatterIndentSize: 4 });
    await vi.waitFor(() => {
      expect(
        transport.methods("workspace/didChangeConfiguration"),
      ).toHaveLength(1);
    });
    await controller.whenIdle();
    expect(
      transport.methods("workspace/didChangeConfiguration")[0]?.params,
    ).toEqual({
      settings: {
        exportPdf: "never",
        compileStatus: "disable",
        formatterMode: "typstyle",
        formatterPrintWidth: 80,
        formatterIndentSize: 4,
        lint: { enabled: false, when: "onSave" },
      },
    });
    expect(transport.methods("initialize")).toHaveLength(1);
  });

  it("restarts Tinymist when lint is switched because the server reads it at startup", async () => {
    const { controller, transport, settings } = harness();
    controller.update(typstSnapshot());
    await controller.whenIdle();

    settings.set({ lint: true });
    await controller.whenIdle();
    await vi.waitFor(() => {
      expect(transport.methods("initialize")).toHaveLength(2);
    });
    expect(
      (
        transport.methods("initialize")[1].params as {
          initializationOptions: { lint: unknown };
        }
      ).initializationOptions.lint,
    ).toEqual({ enabled: true, when: "onSave" });
    expect(transport.methods("shutdown")).toHaveLength(1);
  });

  it("forwards a completed save so on-save lint runs", async () => {
    const { controller, transport } = harness();
    const content = "#include \"chapter.typ\"\n";
    controller.update(
      typstSnapshot({
        files: {
          "main.typ": { content, dirty: true },
          "chapter.typ": { content: "= Chapter\n" },
        },
      }),
    );
    await controller.whenIdle();
    expect(transport.methods("textDocument/didSave")).toHaveLength(0);

    controller.update(
      typstSnapshot({
        files: {
          "main.typ": { content, dirty: false },
          "chapter.typ": { content: "= Chapter\n" },
        },
      }),
    );
    await vi.waitFor(() => {
      expect(transport.methods("textDocument/didSave")).toHaveLength(1);
    });
    expect(transport.methods("textDocument/didSave")[0]?.params).toEqual({
      textDocument: { uri: "file:///project/main.typ" },
    });
  });

  it("leaves the TexLab profile and main document alone", async () => {
    const { controller, transport } = harness();
    controller.update(
      typstSnapshot({
        engineId: "latex",
        mainDoc: "main.tex",
        tree: [{ path: "main.tex", is_dir: false }],
        files: { "main.tex": { content: "\\section{A}" } },
      }),
    );
    await controller.whenIdle();
    const [initialize] = transport.methods("initialize");
    expect(
      (initialize.params as { initializationOptions: unknown })
        .initializationOptions,
    ).toEqual(getLanguageServiceRuntimeProfile("texlab").initializationOptions);
    expect(transport.methods("workspace/executeCommand")).toHaveLength(0);
  });

  it("stops listening to settings after disposal", async () => {
    const { controller, settings } = harness();
    expect(settings.listenerCount()).toBe(1);
    await controller.dispose();
    expect(settings.listenerCount()).toBe(0);
  });
});
