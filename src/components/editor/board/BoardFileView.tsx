import "@excalidraw/excalidraw/index.css";
import {
  CaptureUpdateAction,
  Excalidraw,
  MainMenu,
  hashElementsVersion,
  languages,
  restoreElements,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI, UIOptions } from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PdfStateMessage } from "@/components/preview/PdfStateMessage";
import { LoadingState } from "@/components/ui/empty";
import { ownHistory } from "@/lib/field-history";
import { logWarning } from "@/lib/log";
import { basename } from "@/lib/path-utils";
import { useActiveFileReadOnly } from "@/lib/read-only-files";
import { type Theme, useAppTheme } from "@/lib/theme";
import { useFilesStore } from "@/store/files";
import { EXCALIDRAW_ASSET_PATH } from "./board-assets";
import { BOARD_SAVE_DELAY_MS, type BoardScene, boardCamera, boardLanguage, readBoardScene, rememberBoardCamera } from "./board-scene";

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
    EXCALIDRAW_EXPORT_SOURCE?: string;
  }
}

window.EXCALIDRAW_ASSET_PATH = new URL(`${import.meta.env.BASE_URL}${EXCALIDRAW_ASSET_PATH}`, window.location.href).href;
window.EXCALIDRAW_EXPORT_SOURCE = "https://oleafly.com";

const LANGUAGE_CODES = languages.map((language) => language.code);

const UI_OPTIONS: Partial<UIOptions> = {
  canvasActions: { export: false, loadScene: false, saveToActiveFile: false, toggleTheme: null },
};

const HOST =
  "isolate size-full [&_.excalidraw]:[--focus-highlight-color:transparent]! [&_.excalidraw]:[--ui-font:var(--font-sans)]! [&_.default-sidebar-trigger]:hidden! [&_[data-testid=toolbar-frame]+[data-testid=toolbar-embeddable]]:hidden!";

const HISTORY_BUTTONS = { undo: "[data-testid=button-undo]", redo: "[data-testid=button-redo]" } as const;

interface Edit {
  readonly elements: readonly OrderedExcalidrawElement[];
  readonly appState: AppState;
  readonly files: BinaryFiles;
}

function changeKey({ elements, appState, files }: Edit): string {
  return [
    hashElementsVersion(elements),
    Object.keys(files).length,
    appState.viewBackgroundColor,
    appState.gridModeEnabled,
    appState.gridSize,
    appState.gridStep,
  ].join(":");
}

export interface BoardFileViewProps {
  readonly projectId: string;
  readonly path: string;
}

export function BoardFileView({ projectId, path }: BoardFileViewProps) {
  const { t, i18n } = useTranslation(["common", "editor"]);
  const content = useFilesStore((state) => state.files[path]?.content);
  const readOnly = useActiveFileReadOnly();
  const theme = useAppTheme();
  const [opened, setOpened] = useState<{ path: string; scene: BoardScene | null } | null>(null);

  useEffect(() => {
    if (content === undefined || opened?.path === path) return;
    const scene = readBoardScene(content);
    if (!scene) void logWarning("open a board", path);
    setOpened({ path, scene });
  }, [content, opened?.path, path]);

  if (!opened || opened.path !== path) {
    return <LoadingState className="h-full justify-center" label={t(($) => $.common.state.loading)} />;
  }
  if (!opened.scene) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <PdfStateMessage kind="error" title={t(($) => $.editor.board.unreadable)} detail={basename(path)} />
      </div>
    );
  }
  return (
    <Board
      key={path}
      projectId={projectId}
      path={path}
      scene={opened.scene}
      readOnly={readOnly}
      theme={theme}
      langCode={boardLanguage(i18n.language, LANGUAGE_CODES)}
    />
  );
}

interface BoardProps {
  readonly projectId: string;
  readonly path: string;
  readonly scene: BoardScene;
  readonly readOnly: boolean;
  readonly theme: Theme;
  readonly langCode: string;
}

function Board({ projectId, path, scene, readOnly, theme, langCode }: BoardProps) {
  const cameraKey = `${projectId}:${path}`;
  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  const written = useRef(useFilesStore.getState().files[path]?.content);
  const savedKey = useRef<string | null>(null);
  const pending = useRef<Edit | null>(null);
  const timer = useRef<number | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const content = useFilesStore((state) => state.files[path]?.content);

  const initialData = useMemo(() => {
    const camera = boardCamera(cameraKey);
    return {
      elements: scene.elements,
      files: scene.files,
      appState: camera ? { ...scene.appState, ...camera } : scene.appState,
      scrollToContent: !camera,
    } as const;
  }, [cameraKey, scene]);

  const flush = useCallback((): boolean => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const edit = pending.current;
    pending.current = null;
    const files = useFilesStore.getState();
    if (!edit || files.projectId !== projectId) return false;
    const key = changeKey(edit);
    if (key === savedKey.current) return false;
    savedKey.current = key;
    const json = serializeAsJSON(edit.elements, edit.appState, edit.files, "local");
    written.current = json;
    files.setContent(path, json);
    return true;
  }, [path, projectId]);

  useEffect(() => () => void flush(), [flush]);

  const onChange = useCallback(
    (elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      rememberBoardCamera(cameraKey, { scrollX: appState.scrollX, scrollY: appState.scrollY, zoom: appState.zoom });
      const edit = { elements, appState, files };
      if (savedKey.current === null) {
        savedKey.current = changeKey(edit);
        return;
      }
      if (readOnly) return;
      pending.current = edit;
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, BOARD_SAVE_DELAY_MS);
    },
    [cameraKey, flush, readOnly],
  );

  useEffect(() => {
    if (content === undefined || content === written.current || !api.current) return;
    if (flush()) {
      void logWarning("keep board edits over an outside change", path);
      return;
    }
    const next = readBoardScene(content);
    if (!next) {
      void logWarning("read a changed board", path);
      return;
    }
    written.current = content;
    savedKey.current = null;
    const files = Object.values(next.files);
    if (files.length > 0) api.current.addFiles(files);
    const current = api.current.getAppState();
    api.current.updateScene({
      elements: restoreElements(next.elements, null),
      appState: {
        viewBackgroundColor: next.appState.viewBackgroundColor ?? current.viewBackgroundColor,
        gridModeEnabled: next.appState.gridModeEnabled ?? current.gridModeEnabled,
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }, [content, flush, path]);

  const setApi = useCallback((value: ExcalidrawImperativeAPI) => {
    api.current = value;
  }, []);

  useEffect(() => {
    const board = host.current;
    if (!board) return;
    return ownHistory(board, (redo) => {
      board.querySelector<HTMLButtonElement>(redo ? HISTORY_BUTTONS.redo : HISTORY_BUTTONS.undo)?.click();
    });
  }, []);

  return (
    <div ref={host} data-testid="board-view" className={HOST}>
      <Excalidraw
        excalidrawAPI={setApi}
        initialData={initialData}
        onChange={onChange}
        theme={theme}
        langCode={langCode}
        viewModeEnabled={readOnly}
        name={basename(path)}
        aiEnabled={false}
        validateEmbeddable={false}
        autoFocus={false}
        handleKeyboardGlobally={false}
        UIOptions={UI_OPTIONS}
      >
        <MainMenu>
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.DefaultItems.Help />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
        </MainMenu>
      </Excalidraw>
    </div>
  );
}
