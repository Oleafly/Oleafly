import * as DeckApi from "@oleafly/deck";
import { type DeckModule, DeckStage, type DeckStageHandle, readDeckModule, typingInto } from "@oleafly/deck/stage";
import { useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { type ArtifactRuntime, errorPanel, esm, type RuntimeMessages, type RuntimeModule } from "./runtime-core";

export const DECK_MODULES: Record<string, () => RuntimeModule> = {
  "@open-slide/core": () => esm(DeckApi),
  "@oleafly/deck": () => esm(DeckApi),
};

export type DeckMode = "edit" | "present" | "page";

export interface DeckOptions {
  readonly mode: DeckMode;
  readonly page: number;
  readonly revealed?: number;
  readonly assets: Readonly<Record<string, string>>;
  readonly file?: string;
}

export interface DeckMessages extends RuntimeMessages {
  noSlides: string;
}

type HostCommand =
  | { type: "next" }
  | { type: "previous" }
  | { type: "goto"; page: number }
  | { type: "source"; code: string; assets?: Record<string, string> };

export const HOST_EVENT = "oleafly:host";
export const FRAME_EVENT = "oleafly:frame";

const MODIFIER_KEYS = new Set(["Alt", "AltGraph", "Control", "Meta", "Shift"]);

function send(message: Record<string, unknown>): void {
  window.dispatchEvent(new CustomEvent(FRAME_EVENT, { detail: message }));
}

function handBackShortcut(event: KeyboardEvent): void {
  if (event.defaultPrevented || !(event.ctrlKey || event.metaKey || event.altKey)) return;
  if (MODIFIER_KEYS.has(event.key) || event.getModifierState("AltGraph") || typingInto(event.target)) return;
  const { key, code, ctrlKey, metaKey, altKey, shiftKey } = event;
  send({ type: "key", key, code, ctrlKey, metaKey, altKey, shiftKey });
}

export function assetModules(assets: Readonly<Record<string, string>>): Record<string, RuntimeModule> {
  return Object.fromEntries(
    Object.entries(assets).map(([specifier, url]) => [specifier, { __esModule: true, default: url }]),
  );
}

function readCommand(value: unknown): HostCommand | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.type === "next" || record.type === "previous") return { type: record.type };
  if (record.type === "goto" && typeof record.page === "number") return { type: "goto", page: record.page };
  if (record.type === "source" && typeof record.code === "string") {
    const assets = typeof record.assets === "object" && record.assets !== null ? (record.assets as Record<string, string>) : {};
    return { type: "source", code: record.code, assets };
  }
  return null;
}

function DeckApp({
  deck,
  mode,
  page,
  revealed,
  stageRef,
}: Readonly<{
  deck: DeckModule;
  mode: DeckMode;
  page: number;
  revealed: number | undefined;
  stageRef: { current: DeckStageHandle | null };
}>) {
  const stage = useRef<DeckStageHandle>(null);
  stageRef.current = stage.current;
  useEffect(() => {
    stageRef.current = stage.current;
  });
  return (
    <DeckStage
      ref={stage}
      deck={deck}
      page={page}
      revealed={revealed}
      flat={mode !== "edit"}
      keyboard={mode === "edit"}
      preload={mode === "present" ? "all" : "neighbours"}
      onPositionChange={(position) => send({ type: "position", ...position })}
    />
  );
}

export function createDeckRunner(runtime: ArtifactRuntime) {
  return function runDeck(code: string, messages: DeckMessages, options: DeckOptions) {
    runtime.tailwind();
    const host = document.getElementById("root") ?? document.body;
    const Boundary = runtime.boundary(messages);
    const stageRef: { current: DeckStageHandle | null } = { current: null };
    let root: Root | null = null;
    let page = options.page;
    let revealed = options.revealed;
    let revision = 0;
    let assets = options.assets;

    const fail = (title: string, detail: string) => {
      root?.unmount();
      root = null;
      host.replaceChildren(errorPanel(title, detail));
      send({ type: "error", title, detail });
    };

    const load = (source: string) => {
      const result = runtime.compileModule(source, messages, assetModules(assets), options.file);
      if ("error" in result && typeof result.error === "object" && result.error !== null && "title" in result.error) {
        const { title, detail } = result.error as { title: string; detail: string };
        fail(title, detail);
        return;
      }
      const deck = readDeckModule(result as RuntimeModule);
      if (!deck) {
        fail(messages.noSlides, "");
        return;
      }
      revision += 1;
      send({
        type: "deck",
        pages: deck.pages.length,
        notes: deck.pages.map((_, index) => deck.notes[index] ?? null),
        title: typeof deck.meta?.title === "string" ? deck.meta.title : null,
      });
      if (!root) {
        host.replaceChildren();
        root = createRoot(host);
      }
      root.render(
        <Boundary resetKey={revision}>
          <DeckApp deck={deck} mode={options.mode} page={page} revealed={revealed} stageRef={stageRef} />
        </Boundary>,
      );
    };

    window.addEventListener(FRAME_EVENT, (event) => {
      const detail = (event as CustomEvent).detail as Record<string, unknown> | null;
      if (detail?.type !== "position" || typeof detail.page !== "number") return;
      page = detail.page;
      revealed = typeof detail.revealed === "number" ? detail.revealed : undefined;
    });
    window.addEventListener(HOST_EVENT, (event) => {
      const command = readCommand((event as CustomEvent).detail);
      if (!command) return;
      if (command.type === "source") {
        assets = { ...assets, ...command.assets };
        load(command.code);
      }
      else if (command.type === "next") stageRef.current?.next();
      else if (command.type === "previous") stageRef.current?.previous();
      else stageRef.current?.goto(command.page);
    });
    window.addEventListener("keydown", handBackShortcut);
    load(code);
  };
}
