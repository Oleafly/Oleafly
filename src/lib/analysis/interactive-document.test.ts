import { afterEach, describe, expect, it, vi } from "vitest";
import type { LanguageServiceClient } from "@/lib/language-service";
import { useFilesStore } from "@/store/files";
import {
  activeInteractiveDocument,
  currentInteractiveDocument,
  interactiveRequestStillCurrent,
} from "./interactive-document";
import {
  activateInteractiveLanguageService,
  currentInteractiveLanguageService,
  subscribeInteractiveLanguageService,
  type InteractiveLanguageServiceDocument,
  type InteractiveLanguageServiceSession,
} from "./interactive-language-service";

const initialFiles = useFilesStore.getState();
const cleanups: Array<() => void> = [];

function document(
  overrides: Partial<InteractiveLanguageServiceDocument> = {},
): InteractiveLanguageServiceDocument {
  return {
    path: "main.typ",
    uri: "file:///project/main.typ",
    text: "= Paper",
    version: 3,
    ...overrides,
  };
}

function session(
  documents: InteractiveLanguageServiceDocument[] = [document()],
  overrides: Partial<InteractiveLanguageServiceSession> = {},
): InteractiveLanguageServiceSession {
  return {
    owner: {},
    projectId: "project-a",
    projectRevision: 4,
    kind: "tinymist",
    positionEncoding: "utf-16",
    client: { generation: 2 } as LanguageServiceClient,
    documentForPath: (path) =>
      documents.find((candidate) => candidate.path === path) ?? null,
    ...overrides,
  };
}

function activate(current: InteractiveLanguageServiceSession) {
  const deactivate = activateInteractiveLanguageService(current);
  cleanups.push(deactivate);
  return deactivate;
}

function openFile(path: string, content: string, projectId = "project-a") {
  useFilesStore.setState({
    projectId,
    activePath: path,
    files: {
      ...useFilesStore.getState().files,
      [path]: { content, dirty: false },
    },
  });
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  useFilesStore.setState(initialFiles, true);
});

describe("interactive language-service session", () => {
  it("notifies listeners on activation and only the owner can clear it", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeInteractiveLanguageService(listener);
    const first = session();
    const deactivateFirst = activate(first);
    const second = session();
    const deactivateSecond = activate(second);
    expect(listener).toHaveBeenCalledTimes(2);

    deactivateFirst();
    expect(currentInteractiveLanguageService()).toBe(second);
    expect(listener).toHaveBeenCalledTimes(2);

    deactivateSecond();
    expect(currentInteractiveLanguageService()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
  });

  it("keeps notifying the other surfaces when one listener throws", () => {
    const failing = subscribeInteractiveLanguageService(() => {
      throw new Error("surface crashed");
    });
    const listener = vi.fn();
    const healthy = subscribeInteractiveLanguageService(listener);
    expect(() => activate(session())).not.toThrow();
    expect(listener).toHaveBeenCalledTimes(1);
    failing();
    healthy();
  });
});

describe("currentInteractiveDocument", () => {
  it("returns the synchronized document for the active, unchanged file", () => {
    const current = session();
    activate(current);
    openFile("main.typ", "= Paper");
    expect(currentInteractiveDocument("main.typ", "= Paper")).toEqual({
      session: current,
      document: document(),
    });
    expect(activeInteractiveDocument("= Paper")?.document.uri).toBe(
      "file:///project/main.typ",
    );
  });

  it("returns nothing without a session or for another project, path or text", () => {
    openFile("main.typ", "= Paper");
    expect(currentInteractiveDocument("main.typ", "= Paper")).toBeNull();

    activate(session());
    expect(currentInteractiveDocument("other.typ", "= Paper")).toBeNull();
    expect(currentInteractiveDocument("main.typ", "= Edited")).toBeNull();
    openFile("main.typ", "= Paper", "project-b");
    expect(currentInteractiveDocument("main.typ", "= Paper")).toBeNull();
  });

  it("returns nothing when the server has not opened the file or holds older text", () => {
    activate(session([document({ path: "main.typ", text: "= Old" })]));
    openFile("main.typ", "= Paper");
    expect(currentInteractiveDocument("main.typ", "= Paper")).toBeNull();

    openFile("notes.typ", "notes");
    expect(currentInteractiveDocument("notes.typ", "notes")).toBeNull();
  });

  it("returns nothing for the active document when no file is active", () => {
    activate(session());
    useFilesStore.setState({ projectId: "project-a", activePath: null });
    expect(activeInteractiveDocument("= Paper")).toBeNull();
  });
});

describe("interactiveRequestStillCurrent", () => {
  it("accepts only the same owner, revision, generation, uri and version", () => {
    const current = session();
    activate(current);
    openFile("main.typ", "= Paper");
    const requested = document();
    expect(
      interactiveRequestStillCurrent(current, requested, "= Paper"),
    ).toBe(true);
    expect(
      interactiveRequestStillCurrent(
        { ...current, owner: {} },
        requested,
        "= Paper",
      ),
    ).toBe(false);
    expect(
      interactiveRequestStillCurrent(
        { ...current, projectRevision: 3 },
        requested,
        "= Paper",
      ),
    ).toBe(false);
    expect(
      interactiveRequestStillCurrent(
        current,
        { ...requested, version: 2 },
        "= Paper",
      ),
    ).toBe(false);
    expect(
      interactiveRequestStillCurrent(current, requested, "= Changed"),
    ).toBe(false);
  });
});
